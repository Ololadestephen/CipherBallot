// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CipherBallotCommitReveal
/// @notice BOT Chain EVM edition of CipherBallot with commit-reveal and secret-sealed threshold voting modes.
contract CipherBallotCommitReveal {
    uint256 public constant MIN_OPTIONS = 2;
    uint256 public constant MAX_OPTIONS = 8;
    uint256 public constant MAX_ALLOWLIST = 128;
    uint256 public constant MAX_COMMITTEE = 16;
    uint256 public constant MAX_TITLE_BYTES = 160;
    uint256 public constant MAX_OPTION_BYTES = 96;
    uint256 public constant MAX_PRIVATE_BALLOT_BYTES = 4096;
    uint256 public constant MAX_TALLY_URI_BYTES = 512;
    uint64 public constant DEFAULT_REVEAL_PERIOD = 1 days;
    bytes32 public constant AGENT_BALLOT_TYPEHASH = keccak256(
        "AgentBallot(address voter,address agent,uint256 proposalId,bytes32 privateBallotHash,bytes32 ballotProofHash,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant VOTER_BALLOT_TYPEHASH = keccak256(
        "VoterBallot(address voter,uint256 proposalId,bytes32 privateBallotHash,bytes32 ballotProofHash,uint256 nonce,uint64 deadline)"
    );
    bytes32 public constant PUBLIC_AGENT_BALLOT_TYPEHASH = keccak256(
        "PublicAgentBallot(address agent,uint256 proposalId,bytes32 privateBallotHash,bytes32 ballotProofHash,uint256 nonce,uint64 deadline)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("CipherBallot");
    bytes32 private constant VERSION_HASH = keccak256("2");
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    uint256 private constant SECP256K1_FIELD_ORDER = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f;

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
        bytes encryptionPublicKey;
    }

    struct BallotCommitment {
        bytes32 commitment;
        bool revealed;
    }

    struct AgentDelegation {
        uint64 expiresAt;
        uint256 proposalId;
        bool active;
    }

    uint256 public proposalCount;

    mapping(uint256 proposalId => Proposal) private proposals;
    mapping(uint256 proposalId => mapping(address voter => BallotCommitment)) private commitments;
    mapping(uint256 proposalId => mapping(address voter => bytes32)) private privateBallotHashes;
    mapping(uint256 proposalId => mapping(address voter => bool)) private allowedVoters;
    mapping(uint256 proposalId => mapping(address member => bool)) private committeeMembers;
    mapping(uint256 proposalId => mapping(address member => bool)) private tallyApprovals;
    mapping(address voter => mapping(address agent => AgentDelegation)) private agentDelegations;
    mapping(address voter => mapping(address agent => uint256)) public agentNonces;
    mapping(address voter => uint256) public voterBallotNonces;
    mapping(address agent => uint256) public publicAgentNonces;

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
        uint256 indexed proposalId, address indexed voter, bytes32 privateBallotHash, bytes32 ballotProofHash
    );
    event AgentDelegationSet(
        address indexed voter, address indexed agent, uint64 expiresAt, uint256 indexed proposalId
    );
    event AgentDelegationRevoked(address indexed voter, address indexed agent);
    event AgentBallotSubmitted(
        uint256 indexed proposalId, address indexed voter, address indexed agent, uint256 nonce, address relayer
    );
    event VoterSignedBallotSubmitted(
        uint256 indexed proposalId, address indexed voter, uint256 nonce, address indexed relayer
    );
    event PublicAgentBallotSubmitted(
        uint256 indexed proposalId, address indexed agent, uint256 nonce, address indexed relayer
    );
    event EncryptionKeyPublished(uint256 indexed proposalId, bytes encryptionPublicKey);
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
    error InvalidTitle();
    error InvalidOptionText();
    error DuplicateOption();
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
    error InvalidAllowlist();
    error CommitteeTooLarge();
    error InvalidCommittee();
    error InvalidThreshold();
    error InvalidMode();
    error EmptyPrivateBallot();
    error BallotTooLarge();
    error InvalidBallotProof();
    error InvalidTallySecret();
    error NotCommitteeMember();
    error AlreadyApproved();
    error TallyMismatch();
    error TallyExceedsVoteCount();
    error InvalidTallyURI();
    error InvalidTallyProof();
    error CommitteeThresholdNotMet();
    error NotEligible();
    error InvalidAgent();
    error InvalidDelegationExpiry();
    error AgentNotAuthorized();
    error AgentAuthorizationExpired();
    error AgentProposalNotAuthorized();
    error AgentVoteExpired();
    error InvalidAgentNonce();
    error InvalidAgentSignature();
    error InvalidVoter();
    error InvalidVoterNonce();
    error InvalidVoterSignature();
    error InvalidPublicAgentNonce();
    error InvalidPublicAgentSignature();
    error ProposalNotPublic();
    error InvalidEncryptionPublicKey();

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
        bytes calldata encryptionPublicKey,
        bytes32 tallySecretCommitment
    ) external returns (uint256 proposalId) {
        if (committee.length < 2) revert InvalidCommittee();
        if (committee.length > MAX_COMMITTEE) revert CommitteeTooLarge();
        if (threshold < 2 || threshold > committee.length) revert InvalidThreshold();
        _validateEncryptionPublicKey(encryptionPublicKey);
        if (tallySecretCommitment == bytes32(0)) revert InvalidTallySecret();

        proposalId = _createBaseProposal(title, options, startTime, endTime, allowlist, PrivacyMode.SecretSealed);
        Proposal storage proposal = proposals[proposalId];
        proposal.threshold = threshold;
        proposal.encryptionPublicKey = encryptionPublicKey;
        proposal.tallySecretCommitment = tallySecretCommitment;

        for (uint256 i = 0; i < committee.length; i++) {
            address member = committee[i];
            if (member == address(0) || committeeMembers[proposalId][member]) revert InvalidCommittee();
            committeeMembers[proposalId][member] = true;
            proposal.committeeMemberCount++;
        }

        if (proposal.committeeMemberCount < threshold) revert InvalidThreshold();
        emit EncryptionKeyPublished(proposalId, encryptionPublicKey);
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

        commitments[proposalId][msg.sender] = BallotCommitment({commitment: commitment, revealed: false});
        proposal.voteCount++;

        emit VoteCommitted(proposalId, msg.sender, commitment);
    }

    function submitPrivateBallot(uint256 proposalId, bytes calldata privateBallot, bytes32 ballotProofHash) external {
        _submitPrivateBallot(proposalId, msg.sender, privateBallot, ballotProofHash);
    }

    /// @notice Authorizes an agent to sign ballots for the caller.
    /// @param proposalId Zero permits any proposal; a non-zero value restricts the agent to one proposal.
    function setAgentDelegation(address agent, uint64 expiresAt, uint256 proposalId) external {
        if (agent == address(0) || agent == msg.sender) revert InvalidAgent();
        if (expiresAt <= block.timestamp) revert InvalidDelegationExpiry();
        if (proposalId != 0) _proposal(proposalId);

        AgentDelegation storage delegation = agentDelegations[msg.sender][agent];
        if (delegation.active) agentNonces[msg.sender][agent]++;
        delegation.expiresAt = expiresAt;
        delegation.proposalId = proposalId;
        delegation.active = true;

        emit AgentDelegationSet(msg.sender, agent, expiresAt, proposalId);
    }

    function revokeAgentDelegation(address agent) external {
        AgentDelegation storage delegation = agentDelegations[msg.sender][agent];
        if (!delegation.active) revert AgentNotAuthorized();
        delegation.active = false;
        agentNonces[msg.sender][agent]++;
        emit AgentDelegationRevoked(msg.sender, agent);
    }

    /// @notice Relays an agent-signed private ballot while attributing participation to the delegating voter.
    function submitPrivateBallotByAgent(
        uint256 proposalId,
        address voter,
        address agent,
        bytes calldata privateBallot,
        bytes32 ballotProofHash,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        AgentDelegation storage delegation = agentDelegations[voter][agent];
        if (!delegation.active) revert AgentNotAuthorized();
        if (block.timestamp > delegation.expiresAt) revert AgentAuthorizationExpired();
        if (delegation.proposalId != 0 && delegation.proposalId != proposalId) {
            revert AgentProposalNotAuthorized();
        }
        if (block.timestamp > deadline) revert AgentVoteExpired();
        if (nonce != agentNonces[voter][agent]) revert InvalidAgentNonce();

        bytes32 privateBallotHash = keccak256(privateBallot);
        bytes32 digest =
            makeAgentBallotDigest(voter, agent, proposalId, privateBallotHash, ballotProofHash, nonce, deadline);
        if (_recoverSigner(digest, signature) != agent) revert InvalidAgentSignature();

        agentNonces[voter][agent] = nonce + 1;
        _submitPrivateBallot(proposalId, voter, privateBallot, ballotProofHash);
        emit AgentBallotSubmitted(proposalId, voter, agent, nonce, msg.sender);
    }

    /// @notice Relays a one-time ballot signed directly by the voter without creating a standing delegation.
    function submitPrivateBallotByVoterSignature(
        uint256 proposalId,
        address voter,
        bytes calldata privateBallot,
        bytes32 ballotProofHash,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        if (voter == address(0)) revert InvalidVoter();
        if (block.timestamp > deadline) revert AgentVoteExpired();
        if (nonce != voterBallotNonces[voter]) revert InvalidVoterNonce();

        bytes32 privateBallotHash = keccak256(privateBallot);
        bytes32 digest = makeVoterBallotDigest(voter, proposalId, privateBallotHash, ballotProofHash, nonce, deadline);
        if (_recoverSigner(digest, signature) != voter) revert InvalidVoterSignature();

        voterBallotNonces[voter] = nonce + 1;
        _submitPrivateBallot(proposalId, voter, privateBallot, ballotProofHash);
        emit VoterSignedBallotSubmitted(proposalId, voter, nonce, msg.sender);
    }

    /// @notice Relays a ballot owned by an agent wallet for a public proposal; no voter delegation is involved.
    function submitPublicAgentBallot(
        uint256 proposalId,
        address agent,
        bytes calldata privateBallot,
        bytes32 ballotProofHash,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        if (agent == address(0)) revert InvalidAgent();
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.allowlistEnabled) revert ProposalNotPublic();
        if (block.timestamp > deadline) revert AgentVoteExpired();
        if (nonce != publicAgentNonces[agent]) revert InvalidPublicAgentNonce();

        bytes32 privateBallotHash = keccak256(privateBallot);
        bytes32 digest =
            makePublicAgentBallotDigest(agent, proposalId, privateBallotHash, ballotProofHash, nonce, deadline);
        if (_recoverSigner(digest, signature) != agent) revert InvalidPublicAgentSignature();

        publicAgentNonces[agent] = nonce + 1;
        _submitPrivateBallot(proposalId, agent, privateBallot, ballotProofHash);
        emit PublicAgentBallotSubmitted(proposalId, agent, nonce, msg.sender);
    }

    function getAgentDelegation(address voter, address agent)
        external
        view
        returns (uint64 expiresAt, uint256 proposalId, bool active)
    {
        AgentDelegation storage delegation = agentDelegations[voter][agent];
        return (delegation.expiresAt, delegation.proposalId, delegation.active);
    }

    function makeAgentBallotDigest(
        address voter,
        address agent,
        uint256 proposalId,
        bytes32 privateBallotHash,
        bytes32 ballotProofHash,
        uint256 nonce,
        uint64 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                AGENT_BALLOT_TYPEHASH, voter, agent, proposalId, privateBallotHash, ballotProofHash, nonce, deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function makeVoterBallotDigest(
        address voter,
        uint256 proposalId,
        bytes32 privateBallotHash,
        bytes32 ballotProofHash,
        uint256 nonce,
        uint64 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(VOTER_BALLOT_TYPEHASH, voter, proposalId, privateBallotHash, ballotProofHash, nonce, deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function makePublicAgentBallotDigest(
        address agent,
        uint256 proposalId,
        bytes32 privateBallotHash,
        bytes32 ballotProofHash,
        uint256 nonce,
        uint64 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                PUBLIC_AGENT_BALLOT_TYPEHASH, agent, proposalId, privateBallotHash, ballotProofHash, nonce, deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _submitPrivateBallot(
        uint256 proposalId,
        address voter,
        bytes calldata privateBallot,
        bytes32 ballotProofHash
    ) private {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.mode != PrivacyMode.SecretSealed) revert InvalidMode();
        if (privateBallot.length == 0) revert EmptyPrivateBallot();
        if (privateBallot.length > MAX_PRIVATE_BALLOT_BYTES) revert BallotTooLarge();
        if (block.timestamp < proposal.startTime) revert VotingNotStarted();
        if (block.timestamp > proposal.endTime) revert VotingEnded();
        if (proposal.finalized) revert AlreadyFinalized();
        if (proposal.allowlistEnabled && !allowedVoters[proposalId][voter]) revert NotEligible();
        if (privateBallotHashes[proposalId][voter] != bytes32(0)) revert AlreadyVoted();

        bytes32 privateBallotHash = keccak256(privateBallot);
        if (ballotProofHash != makeEncryptedBallotProofHash(privateBallotHash)) revert InvalidBallotProof();
        privateBallotHashes[proposalId][voter] = privateBallotHash;
        proposal.voteCount++;

        emit PrivateBallotSubmitted(proposalId, voter, privateBallotHash, ballotProofHash);
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
        if (bytes(tallyURI).length == 0 || bytes(tallyURI).length > MAX_TALLY_URI_BYTES) {
            revert InvalidTallyURI();
        }
        if (tallyProofHash == bytes32(0)) revert InvalidTallyProof();
        if (keccak256(bytes(tallySecret)) != proposal.tallySecretCommitment) revert InvalidTallySecret();

        uint256 talliedVotes;
        for (uint256 i = 0; i < finalTally.length; i++) {
            talliedVotes += finalTally[i];
        }
        if (talliedVotes > proposal.voteCount) revert TallyExceedsVoteCount();

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

        emit ThresholdTallyApproved(proposalId, msg.sender, tallyHash, proposal.tallyApprovalCount, proposal.threshold);

        if (proposal.tallyApprovalCount >= proposal.threshold) {
            proposal.finalized = true;
            emit ProposalFinalized(proposalId, proposal.voteCount);
        }
    }

    function makeCommitment(uint256 proposalId, address voter, uint256 optionIndex, bytes32 secret)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(proposalId, voter, optionIndex, secret));
    }

    function makeEncryptedBallotProofHash(bytes32 privateBallotHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("CipherBallot encrypted ballot proof v1", privateBallotHash));
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

    function getCommitment(uint256 proposalId, address voter)
        external
        view
        returns (bytes32 commitment, bool revealed)
    {
        _proposal(proposalId);
        BallotCommitment storage ballot = commitments[proposalId][voter];
        return (ballot.commitment, ballot.revealed);
    }

    function getPrivateBallotHash(uint256 proposalId, address voter) external view returns (bytes32) {
        _proposal(proposalId);
        return privateBallotHashes[proposalId][voter];
    }

    function getEncryptionPublicKey(uint256 proposalId) external view returns (bytes memory) {
        Proposal storage proposal = _proposal(proposalId);
        if (proposal.mode != PrivacyMode.SecretSealed) revert InvalidMode();
        return proposal.encryptionPublicKey;
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
        if (bytes(title).length == 0 || bytes(title).length > MAX_TITLE_BYTES) revert InvalidTitle();
        if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) revert InvalidOptions();
        if (endTime <= startTime || endTime <= block.timestamp) revert InvalidVotingWindow();
        if (allowlist.length > MAX_ALLOWLIST) revert AllowlistTooLarge();

        for (uint256 i = 0; i < options.length; i++) {
            bytes memory option = bytes(options[i]);
            if (option.length == 0 || option.length > MAX_OPTION_BYTES) revert InvalidOptionText();
            bytes32 optionHash = keccak256(option);
            for (uint256 j = 0; j < i; j++) {
                if (optionHash == keccak256(bytes(options[j]))) revert DuplicateOption();
            }
        }

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
            if (voter == address(0) || allowedVoters[proposalId][voter]) revert InvalidAllowlist();
            allowedVoters[proposalId][voter] = true;
            proposal.allowedVoterCount++;
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

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _validateEncryptionPublicKey(bytes calldata encryptionPublicKey) private pure {
        if (encryptionPublicKey.length != 65 || encryptionPublicKey[0] != 0x04) {
            revert InvalidEncryptionPublicKey();
        }
        uint256 x;
        uint256 y;
        assembly {
            x := calldataload(add(encryptionPublicKey.offset, 1))
            y := calldataload(add(encryptionPublicKey.offset, 33))
        }
        if (x >= SECP256K1_FIELD_ORDER || y >= SECP256K1_FIELD_ORDER) revert InvalidEncryptionPublicKey();
        uint256 left = mulmod(y, y, SECP256K1_FIELD_ORDER);
        uint256 right =
            addmod(mulmod(mulmod(x, x, SECP256K1_FIELD_ORDER), x, SECP256K1_FIELD_ORDER), 7, SECP256K1_FIELD_ORDER);
        if (left != right) revert InvalidEncryptionPublicKey();
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidAgentSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (uint256(s) > SECP256K1_HALF_ORDER || (v != 27 && v != 28)) revert InvalidAgentSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidAgentSignature();
    }
}
