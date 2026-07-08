// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CipherBallotCommitReveal
/// @notice BOT Chain EVM edition of CipherBallot with commit-reveal and secret-sealed threshold voting modes.
contract CipherBallotCommitReveal {
    uint256 public constant MIN_OPTIONS = 2;
    uint256 public constant MAX_OPTIONS = 8;
    uint256 public constant MAX_ALLOWLIST = 128;
    uint256 public constant MAX_COMMITTEE = 16;
    uint64 public constant DEFAULT_REVEAL_PERIOD = 1 days;

    enum PrivacyMode {
        CommitReveal,
        SecretSealed
    }

    struct Proposal {
        address creator;
        string title;
        string[] options;
        PrivacyMode mode;
        uint64 startTime;
        uint64 endTime;
        uint64 revealDeadline;
        bool allowlistEnabled;
        uint256 allowedVoterCount;
        bool finalized;
        uint256 voteCount;
        uint256 revealCount;
        uint256[] finalTally;
        bytes32 tallySecretCommitment;
        uint256 committeeMemberCount;
        uint256 threshold;
        uint256 tallyApprovalCount;
        bytes32 tallyHash;
        string tallyURI;
        bytes32 tallyProofHash;
    }

    struct BallotCommitment {
        bytes32 commitment;
        bool revealed;
    }

    uint256 public proposalCount;

    mapping(uint256 proposalId => Proposal) private proposals;
    mapping(uint256 proposalId => mapping(address voter => BallotCommitment)) private commitments;
    mapping(uint256 proposalId => mapping(address voter => bytes32)) private privateBallotHashes;
    mapping(uint256 proposalId => mapping(address voter => bool)) private allowedVoters;
    mapping(uint256 proposalId => mapping(address member => bool)) private committeeMembers;
    mapping(uint256 proposalId => mapping(address member => bool)) private tallyApprovals;

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed creator,
        string title,
        PrivacyMode mode,
        uint64 startTime,
        uint64 endTime,
        uint64 revealDeadline,
        bool allowlistEnabled,
        uint256 allowedVoterCount
    );
    event VoteCommitted(uint256 indexed proposalId, address indexed voter, bytes32 commitment);
    event PrivateBallotSubmitted(
        uint256 indexed proposalId,
        address indexed voter,
        bytes32 privateBallotHash,
        bytes32 ballotProofHash
    );
    event VoteRevealed(uint256 indexed proposalId, address indexed voter, uint256 indexed optionIndex);
    event ProposalFinalized(uint256 indexed proposalId, uint256 revealCount);
    event ThresholdTallyApproved(
        uint256 indexed proposalId,
        address indexed committeeMember,
        bytes32 tallyHash,
        uint256 approvalCount,
        uint256 threshold
    );

    error InvalidOptions();
    error InvalidVotingWindow();
    error ProposalNotFound();
    error VotingNotStarted();
    error VotingEnded();
    error VotingNotEnded();
    error AlreadyVoted();
    error NoCommitment();
    error AlreadyRevealed();
    error InvalidReveal();
    error InvalidOption();
    error AlreadyFinalized();
    error EmptyCommitment();
    error RevealPeriodActive();
    error AllowlistTooLarge();
    error CommitteeTooLarge();
    error InvalidCommittee();
    error InvalidThreshold();
    error InvalidMode();
    error EmptyPrivateBallot();
    error InvalidTallySecret();
    error NotCommitteeMember();
    error AlreadyApproved();
    error TallyMismatch();
    error CommitteeThresholdNotMet();
    error NotEligible();

    function createProposal(
        string calldata title,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime,
        address[] calldata allowlist
    ) external returns (uint256 proposalId) {
        proposalId = _createBaseProposal(title, options, startTime, endTime, allowlist, PrivacyMode.CommitReveal);
    }

    function createThresholdProposal(
        string calldata title,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime,
        address[] calldata allowlist,
        address[] calldata committee,
        uint256 threshold,
        bytes32 tallySecretCommitment
    ) external returns (uint256 proposalId) {
        if (committee.length < 2) revert InvalidCommittee();
        if (committee.length > MAX_COMMITTEE) revert CommitteeTooLarge();
        if (threshold < 2 || threshold > committee.length) revert InvalidThreshold();
        if (tallySecretCommitment == bytes32(0)) revert InvalidTallySecret();

        proposalId = _createBaseProposal(title, options, startTime, endTime, allowlist, PrivacyMode.SecretSealed);
        Proposal storage proposal = proposals[proposalId];
        proposal.threshold = threshold;
        proposal.tallySecretCommitment = tallySecretCommitment;

        for (uint256 i = 0; i < committee.length; i++) {
            address member = committee[i];
            if (member == address(0)) revert InvalidCommittee();
            if (!committeeMembers[proposalId][member]) {
                committeeMembers[proposalId][member] = true;
                proposal.committeeMemberCount++;
            }
        }

        if (proposal.committeeMemberCount < threshold) revert InvalidThreshold();
    }

    function commitVote(uint256 proposalId, bytes32 commitment) external {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.mode != PrivacyMode.CommitReveal) revert InvalidMode();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (block.timestamp < proposal.startTime) revert VotingNotStarted();
        if (block.timestamp > proposal.endTime) revert VotingEnded();
        if (proposal.finalized) revert AlreadyFinalized();
        if (proposal.allowlistEnabled && !allowedVoters[proposalId][msg.sender]) revert NotEligible();
        if (commitments[proposalId][msg.sender].commitment != bytes32(0)) revert AlreadyVoted();

        commitments[proposalId][msg.sender] = BallotCommitment({ commitment: commitment, revealed: false });
        proposal.voteCount++;

        emit VoteCommitted(proposalId, msg.sender, commitment);
    }

    function submitPrivateBallot(
        uint256 proposalId,
        bytes calldata privateBallot,
        bytes32 ballotProofHash
    ) external {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.mode != PrivacyMode.SecretSealed) revert InvalidMode();
        if (privateBallot.length == 0) revert EmptyPrivateBallot();
        if (block.timestamp < proposal.startTime) revert VotingNotStarted();
        if (block.timestamp > proposal.endTime) revert VotingEnded();
        if (proposal.finalized) revert AlreadyFinalized();
        if (proposal.allowlistEnabled && !allowedVoters[proposalId][msg.sender]) revert NotEligible();
        if (privateBallotHashes[proposalId][msg.sender] != bytes32(0)) revert AlreadyVoted();

        bytes32 privateBallotHash = keccak256(privateBallot);
        privateBallotHashes[proposalId][msg.sender] = privateBallotHash;
        proposal.voteCount++;

        emit PrivateBallotSubmitted(proposalId, msg.sender, privateBallotHash, ballotProofHash);
    }

    function revealVote(uint256 proposalId, uint256 optionIndex, bytes32 secret) external {
        Proposal storage proposal = _proposal(proposalId);
        BallotCommitment storage ballot = commitments[proposalId][msg.sender];

        if (proposal.mode != PrivacyMode.CommitReveal) revert InvalidMode();
        if (block.timestamp <= proposal.endTime) revert VotingNotEnded();
        if (proposal.finalized) revert AlreadyFinalized();
        if (ballot.commitment == bytes32(0)) revert NoCommitment();
        if (ballot.revealed) revert AlreadyRevealed();
        if (optionIndex >= proposal.options.length) revert InvalidOption();

        bytes32 expected = makeCommitment(proposalId, msg.sender, optionIndex, secret);
        if (expected != ballot.commitment) revert InvalidReveal();

        ballot.revealed = true;
        proposal.finalTally[optionIndex]++;
        proposal.revealCount++;

        emit VoteRevealed(proposalId, msg.sender, optionIndex);
    }

    function finalizeProposal(uint256 proposalId) external {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.mode != PrivacyMode.CommitReveal) revert InvalidMode();
        if (block.timestamp <= proposal.endTime) revert VotingNotEnded();
        if (proposal.finalized) revert AlreadyFinalized();
        if (proposal.revealCount < proposal.voteCount && block.timestamp <= proposal.revealDeadline) {
            revert RevealPeriodActive();
        }

        proposal.finalized = true;
        emit ProposalFinalized(proposalId, proposal.revealCount);
    }

    function approveThresholdTally(
        uint256 proposalId,
        uint256[] calldata finalTally,
        string calldata tallyURI,
        bytes32 tallyProofHash,
        string calldata tallySecret
    ) external {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.mode != PrivacyMode.SecretSealed) revert InvalidMode();
        if (block.timestamp <= proposal.endTime) revert VotingNotEnded();
        if (proposal.finalized) revert AlreadyFinalized();
        if (!committeeMembers[proposalId][msg.sender]) revert NotCommitteeMember();
        if (tallyApprovals[proposalId][msg.sender]) revert AlreadyApproved();
        if (finalTally.length != proposal.options.length) revert InvalidOptions();
        if (keccak256(bytes(tallySecret)) != proposal.tallySecretCommitment) revert InvalidTallySecret();

        bytes32 tallyHash = keccak256(abi.encode(proposalId, finalTally, tallyURI, tallyProofHash));
        if (proposal.tallyHash == bytes32(0)) {
            proposal.tallyHash = tallyHash;
            proposal.tallyURI = tallyURI;
            proposal.tallyProofHash = tallyProofHash;
            for (uint256 i = 0; i < finalTally.length; i++) {
                proposal.finalTally[i] = finalTally[i];
            }
        } else if (proposal.tallyHash != tallyHash) {
            revert TallyMismatch();
        }

        tallyApprovals[proposalId][msg.sender] = true;
        proposal.tallyApprovalCount++;

        emit ThresholdTallyApproved(
            proposalId,
            msg.sender,
            tallyHash,
            proposal.tallyApprovalCount,
            proposal.threshold
        );

        if (proposal.tallyApprovalCount >= proposal.threshold) {
            proposal.finalized = true;
            emit ProposalFinalized(proposalId, proposal.voteCount);
        }
    }

    function makeCommitment(
        uint256 proposalId,
        address voter,
        uint256 optionIndex,
        bytes32 secret
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(proposalId, voter, optionIndex, secret));
    }

    function getProposal(uint256 proposalId)
        external
        view
        returns (
            address creator,
            string memory title,
            string[] memory options,
            uint64 startTime,
            uint64 endTime,
            uint64 revealDeadline,
            bool allowlistEnabled,
            uint256 allowedVoterCount,
            bool finalized,
            uint256 voteCount,
            uint256 revealCount,
            uint256[] memory finalTally
        )
    {
        Proposal storage proposal = _proposal(proposalId);
        return (
            proposal.creator,
            proposal.title,
            proposal.options,
            proposal.startTime,
            proposal.endTime,
            proposal.revealDeadline,
            proposal.allowlistEnabled,
            proposal.allowedVoterCount,
            proposal.finalized,
            proposal.voteCount,
            proposal.revealCount,
            proposal.finalTally
        );
    }

    function getCommitment(uint256 proposalId, address voter) external view returns (bytes32 commitment, bool revealed) {
        _proposal(proposalId);
        BallotCommitment storage ballot = commitments[proposalId][voter];
        return (ballot.commitment, ballot.revealed);
    }

    function getPrivateBallotHash(uint256 proposalId, address voter) external view returns (bytes32) {
        _proposal(proposalId);
        return privateBallotHashes[proposalId][voter];
    }

    function getPrivacyConfig(uint256 proposalId)
        external
        view
        returns (
            PrivacyMode mode,
            bytes32 tallySecretCommitment,
            uint256 committeeMemberCount,
            uint256 threshold,
            uint256 tallyApprovalCount,
            bytes32 tallyHash,
            string memory tallyURI,
            bytes32 tallyProofHash
        )
    {
        Proposal storage proposal = _proposal(proposalId);
        return (
            proposal.mode,
            proposal.tallySecretCommitment,
            proposal.committeeMemberCount,
            proposal.threshold,
            proposal.tallyApprovalCount,
            proposal.tallyHash,
            proposal.tallyURI,
            proposal.tallyProofHash
        );
    }

    function isCommitteeMember(uint256 proposalId, address member) external view returns (bool) {
        _proposal(proposalId);
        return committeeMembers[proposalId][member];
    }

    function hasApprovedTally(uint256 proposalId, address member) external view returns (bool) {
        _proposal(proposalId);
        return tallyApprovals[proposalId][member];
    }

    function isAllowed(uint256 proposalId, address voter) external view returns (bool) {
        Proposal storage proposal = _proposal(proposalId);
        return !proposal.allowlistEnabled || allowedVoters[proposalId][voter];
    }

    function optionCount(uint256 proposalId) external view returns (uint256) {
        return _proposal(proposalId).options.length;
    }

    function _createBaseProposal(
        string calldata title,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime,
        address[] calldata allowlist,
        PrivacyMode mode
    ) private returns (uint256 proposalId) {
        if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) revert InvalidOptions();
        if (endTime <= startTime) revert InvalidVotingWindow();
        if (allowlist.length > MAX_ALLOWLIST) revert AllowlistTooLarge();

        proposalId = ++proposalCount;
        Proposal storage proposal = proposals[proposalId];
        proposal.creator = msg.sender;
        proposal.title = title;
        proposal.mode = mode;
        proposal.startTime = startTime;
        proposal.endTime = endTime;
        proposal.revealDeadline = endTime + DEFAULT_REVEAL_PERIOD;
        proposal.allowlistEnabled = allowlist.length > 0;

        for (uint256 i = 0; i < allowlist.length; i++) {
            address voter = allowlist[i];
            if (voter != address(0) && !allowedVoters[proposalId][voter]) {
                allowedVoters[proposalId][voter] = true;
                proposal.allowedVoterCount++;
            }
        }

        for (uint256 i = 0; i < options.length; i++) {
            proposal.options.push(options[i]);
            proposal.finalTally.push(0);
        }

        emit ProposalCreated(
            proposalId,
            msg.sender,
            title,
            mode,
            startTime,
            endTime,
            proposal.revealDeadline,
            proposal.allowlistEnabled,
            proposal.allowedVoterCount
        );
    }

    function _proposal(uint256 proposalId) private view returns (Proposal storage proposal) {
        proposal = proposals[proposalId];
        if (proposal.creator == address(0)) revert ProposalNotFound();
    }
}
