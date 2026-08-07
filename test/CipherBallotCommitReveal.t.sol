// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CipherBallotCommitReveal} from "../src/CipherBallotCommitReveal.sol";

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract CipherBallotCommitRevealTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    CipherBallotCommitReveal private ballot;
    address private alice = address(0xA11CE);
    address private bob = address(0xB0B);
    address private carol = address(0xCA20);
    address private dave = address(0xDAE);
    uint256 private constant AGENT_PRIVATE_KEY = 0xA631;
    uint256 private constant VOTER_PRIVATE_KEY = 0xB01107;
    address private agent;
    address private signedVoter;

    function setUp() public {
        ballot = new CipherBallotCommitReveal();
        agent = vm.addr(AGENT_PRIVATE_KEY);
        signedVoter = vm.addr(VOTER_PRIVATE_KEY);
    }

    function emptyAllowlist() private pure returns (address[] memory allowlist) {
        allowlist = new address[](0);
    }

    function encryptionPublicKey() private pure returns (bytes memory) {
        return hex"0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";
    }

    function encryptedBallotProof(bytes memory encryptedBallot) private view returns (bytes32) {
        return ballot.makeEncryptedBallotProofHash(keccak256(encryptedBallot));
    }

    function createSecretProposal(address[] memory allowlist) private returns (uint256 proposalId) {
        string[] memory options = new string[](2);
        options[0] = "Approve";
        options[1] = "Reject";
        address[] memory committee = new address[](2);
        committee[0] = bob;
        committee[1] = carol;
        proposalId = ballot.createThresholdProposal(
            "Relayed private ballot",
            options,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            allowlist,
            committee,
            2,
            encryptionPublicKey(),
            keccak256("tally-secret")
        );
    }

    function testCreateCommitRevealAndFinalize() public {
        string[] memory options = new string[](3);
        options[0] = "Yes";
        options[1] = "No";
        options[2] = "Abstain";

        uint64 start = uint64(block.timestamp);
        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId = ballot.createProposal("Treasury vote", options, start, end, emptyAllowlist());

        bytes32 aliceSecret = keccak256("alice-secret");
        bytes32 bobSecret = keccak256("bob-secret");
        bytes32 aliceCommitment = ballot.makeCommitment(proposalId, alice, 0, aliceSecret);
        bytes32 bobCommitment = ballot.makeCommitment(proposalId, bob, 1, bobSecret);

        vm.prank(alice);
        ballot.commitVote(proposalId, aliceCommitment);

        vm.prank(bob);
        ballot.commitVote(proposalId, bobCommitment);

        (,,,,,,,,, uint256 voteCountBeforeReveal,, uint256[] memory tallyBeforeReveal) = ballot.getProposal(proposalId);
        assert(voteCountBeforeReveal == 2);
        assert(tallyBeforeReveal[0] == 0);
        assert(tallyBeforeReveal[1] == 0);

        vm.warp(end + 1);

        vm.prank(alice);
        ballot.revealVote(proposalId, 0, aliceSecret);

        vm.prank(bob);
        ballot.revealVote(proposalId, 1, bobSecret);

        ballot.finalizeProposal(proposalId);

        (,,,,,,,, bool finalized, uint256 voteCount, uint256 revealCount, uint256[] memory tally) =
            ballot.getProposal(proposalId);

        assert(finalized);
        assert(voteCount == 2);
        assert(revealCount == 2);
        assert(tally[0] == 1);
        assert(tally[1] == 1);
        assert(tally[2] == 0);
    }

    function testRejectsDuplicateCommitment() public {
        string[] memory options = new string[](2);
        options[0] = "Ship";
        options[1] = "Do not ship";

        uint256 proposalId = ballot.createProposal(
            "Launch vote", options, uint64(block.timestamp), uint64(block.timestamp + 1 days), emptyAllowlist()
        );

        bytes32 secret = keccak256("alice-secret");
        bytes32 commitment = ballot.makeCommitment(proposalId, alice, 0, secret);

        vm.prank(alice);
        ballot.commitVote(proposalId, commitment);

        vm.expectRevert(CipherBallotCommitReveal.AlreadyVoted.selector);
        vm.prank(alice);
        ballot.commitVote(proposalId, commitment);
    }

    function testRejectsInvalidReveal() public {
        string[] memory options = new string[](2);
        options[0] = "A";
        options[1] = "B";

        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId =
            ballot.createProposal("Private vote", options, uint64(block.timestamp), end, emptyAllowlist());

        bytes32 correctSecret = keccak256("correct-secret");
        bytes32 wrongSecret = keccak256("wrong-secret");
        bytes32 commitment = ballot.makeCommitment(proposalId, alice, 1, correctSecret);

        vm.prank(alice);
        ballot.commitVote(proposalId, commitment);

        vm.warp(end + 1);

        vm.expectRevert(CipherBallotCommitReveal.InvalidReveal.selector);
        vm.prank(alice);
        ballot.revealVote(proposalId, 1, wrongSecret);
    }

    function testFinalizeWaitsForRevealPeriodWhenVotesRemainHidden() public {
        string[] memory options = new string[](2);
        options[0] = "A";
        options[1] = "B";

        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId =
            ballot.createProposal("Reveal policy", options, uint64(block.timestamp), end, emptyAllowlist());
        bytes32 commitment = ballot.makeCommitment(proposalId, alice, 0, keccak256("alice"));

        vm.prank(alice);
        ballot.commitVote(proposalId, commitment);

        vm.warp(end + 1);

        vm.expectRevert(CipherBallotCommitReveal.RevealPeriodActive.selector);
        ballot.finalizeProposal(proposalId);

        vm.warp(end + ballot.DEFAULT_REVEAL_PERIOD() + 1);
        ballot.finalizeProposal(proposalId);

        (,,,,,,,, bool finalized, uint256 voteCount, uint256 revealCount,) = ballot.getProposal(proposalId);
        assert(finalized);
        assert(voteCount == 1);
        assert(revealCount == 0);
    }

    function testAllowlistRestrictsCommitments() public {
        string[] memory options = new string[](2);
        options[0] = "A";
        options[1] = "B";

        address[] memory allowlist = new address[](1);
        allowlist[0] = alice;

        uint256 proposalId = ballot.createProposal(
            "Members only", options, uint64(block.timestamp), uint64(block.timestamp + 1 days), allowlist
        );

        bytes32 bobSecret = keccak256("bob-secret");
        bytes32 bobCommitment = ballot.makeCommitment(proposalId, bob, 0, bobSecret);

        vm.expectRevert(CipherBallotCommitReveal.NotEligible.selector);
        vm.prank(bob);
        ballot.commitVote(proposalId, bobCommitment);

        bytes32 aliceSecret = keccak256("alice-secret");
        bytes32 aliceCommitment = ballot.makeCommitment(proposalId, alice, 1, aliceSecret);

        vm.prank(alice);
        ballot.commitVote(proposalId, aliceCommitment);

        assert(ballot.isAllowed(proposalId, alice));
        assert(!ballot.isAllowed(proposalId, bob));
    }

    function testSecretSealedProposalFinalizesAfterCommitteeApprovals() public {
        string[] memory options = new string[](2);
        options[0] = "Fund";
        options[1] = "Reject";

        address[] memory committee = new address[](3);
        committee[0] = alice;
        committee[1] = bob;
        committee[2] = carol;
        string memory tallySecret = "shared-demo-secret";

        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId = ballot.createThresholdProposal(
            "Threshold treasury vote",
            options,
            uint64(block.timestamp),
            end,
            emptyAllowlist(),
            committee,
            2,
            encryptionPublicKey(),
            keccak256(bytes(tallySecret))
        );

        assert(keccak256(ballot.getEncryptionPublicKey(proposalId)) == keccak256(encryptionPublicKey()));

        vm.prank(dave);
        bytes memory encryptedBallot = bytes("private-ballot-1");
        ballot.submitPrivateBallot(proposalId, encryptedBallot, encryptedBallotProof(encryptedBallot));

        vm.warp(end + 1);

        uint256[] memory tally = new uint256[](2);
        tally[0] = 1;
        tally[1] = 0;

        vm.prank(alice);
        ballot.approveThresholdTally(
            proposalId, tally, "ipfs://tally-transcript", keccak256("tally-proof"), tallySecret
        );

        (,,,,,,,, bool finalizedAfterOne,,,) = ballot.getProposal(proposalId);
        assert(!finalizedAfterOne);

        vm.prank(bob);
        ballot.approveThresholdTally(
            proposalId, tally, "ipfs://tally-transcript", keccak256("tally-proof"), tallySecret
        );

        (,,,,,,,, bool finalized, uint256 voteCount,, uint256[] memory finalTally) = ballot.getProposal(proposalId);
        assert(finalized);
        assert(voteCount == 1);
        assert(finalTally[0] == 1);
        assert(finalTally[1] == 0);
    }

    function testThresholdTallyRequiresMatchingApprovals() public {
        string[] memory options = new string[](2);
        options[0] = "A";
        options[1] = "B";

        address[] memory committee = new address[](2);
        committee[0] = alice;
        committee[1] = bob;
        string memory tallySecret = "shared-demo-secret";

        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId = ballot.createThresholdProposal(
            "Threshold consistency",
            options,
            uint64(block.timestamp),
            end,
            emptyAllowlist(),
            committee,
            2,
            encryptionPublicKey(),
            keccak256(bytes(tallySecret))
        );

        bytes memory encryptedBallot = hex"0102";
        vm.prank(dave);
        ballot.submitPrivateBallot(proposalId, encryptedBallot, encryptedBallotProof(encryptedBallot));

        vm.warp(end + 1);

        uint256[] memory firstTally = new uint256[](2);
        firstTally[0] = 1;
        firstTally[1] = 0;

        uint256[] memory secondTally = new uint256[](2);
        secondTally[0] = 0;
        secondTally[1] = 1;

        vm.prank(alice);
        ballot.approveThresholdTally(proposalId, firstTally, "ipfs://tally-a", keccak256("proof"), tallySecret);

        vm.expectRevert(CipherBallotCommitReveal.TallyMismatch.selector);
        vm.prank(bob);
        ballot.approveThresholdTally(proposalId, secondTally, "ipfs://tally-a", keccak256("proof"), tallySecret);
    }

    function testThresholdProposalRejectsInvalidEncryptionKey() public {
        string[] memory options = new string[](2);
        options[0] = "A";
        options[1] = "B";
        address[] memory committee = new address[](2);
        committee[0] = alice;
        committee[1] = bob;

        vm.expectRevert(CipherBallotCommitReveal.InvalidEncryptionPublicKey.selector);
        ballot.createThresholdProposal(
            "Invalid election key",
            options,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            emptyAllowlist(),
            committee,
            2,
            hex"04",
            keccak256("tally-secret")
        );

        vm.expectRevert(CipherBallotCommitReveal.InvalidEncryptionPublicKey.selector);
        ballot.createThresholdProposal(
            "Invalid curve point",
            options,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            emptyAllowlist(),
            committee,
            2,
            abi.encodePacked(bytes1(0x04), bytes32(uint256(1)), bytes32(uint256(2))),
            keccak256("tally-secret")
        );
    }

    function testRejectsBallotWithUnboundProofHash() public {
        uint256 proposalId = createSecretProposal(emptyAllowlist());
        bytes memory encryptedBallot = hex"aabbcc";

        vm.expectRevert(CipherBallotCommitReveal.InvalidBallotProof.selector);
        ballot.submitPrivateBallot(proposalId, encryptedBallot, keccak256("unbound-proof"));
    }

    function testRejectsOversizedEncryptedBallot() public {
        uint256 proposalId = createSecretProposal(emptyAllowlist());
        bytes memory encryptedBallot = new bytes(ballot.MAX_PRIVATE_BALLOT_BYTES() + 1);
        bytes32 proofHash = encryptedBallotProof(encryptedBallot);

        vm.expectRevert(CipherBallotCommitReveal.BallotTooLarge.selector);
        ballot.submitPrivateBallot(proposalId, encryptedBallot, proofHash);
    }

    function testThresholdTallyCannotExceedSubmittedBallots() public {
        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId = createSecretProposal(emptyAllowlist());
        bytes memory encryptedBallot = hex"010203";
        ballot.submitPrivateBallot(proposalId, encryptedBallot, encryptedBallotProof(encryptedBallot));

        vm.warp(end + 1);
        uint256[] memory inflatedTally = new uint256[](2);
        inflatedTally[0] = 2;

        vm.expectRevert(CipherBallotCommitReveal.TallyExceedsVoteCount.selector);
        vm.prank(bob);
        ballot.approveThresholdTally(
            proposalId, inflatedTally, "ipfs://inflated-tally", keccak256("proof"), "tally-secret"
        );
    }

    function testThresholdTallyRequiresEvidence() public {
        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId = createSecretProposal(emptyAllowlist());
        vm.warp(end + 1);
        uint256[] memory tally = new uint256[](2);

        vm.expectRevert(CipherBallotCommitReveal.InvalidTallyURI.selector);
        vm.prank(bob);
        ballot.approveThresholdTally(proposalId, tally, "", keccak256("proof"), "tally-secret");

        vm.expectRevert(CipherBallotCommitReveal.InvalidTallyProof.selector);
        vm.prank(bob);
        ballot.approveThresholdTally(proposalId, tally, "ipfs://tally", bytes32(0), "tally-secret");
    }

    function testRejectsAmbiguousProposalConfiguration() public {
        string[] memory options = new string[](2);
        options[0] = "Same";
        options[1] = "Same";

        vm.expectRevert(CipherBallotCommitReveal.DuplicateOption.selector);
        ballot.createProposal(
            "Duplicate options", options, uint64(block.timestamp), uint64(block.timestamp + 1 days), emptyAllowlist()
        );

        options[1] = "Different";
        address[] memory allowlist = new address[](2);
        allowlist[0] = alice;
        allowlist[1] = alice;

        vm.expectRevert(CipherBallotCommitReveal.InvalidAllowlist.selector);
        ballot.createProposal(
            "Duplicate allowlist", options, uint64(block.timestamp), uint64(block.timestamp + 1 days), allowlist
        );
    }

    function testAuthorizedAgentCanSubmitPrivateBallotThroughRelayer() public {
        string[] memory options = new string[](2);
        options[0] = "Fund";
        options[1] = "Reject";

        address[] memory committee = new address[](2);
        committee[0] = bob;
        committee[1] = carol;
        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId = ballot.createThresholdProposal(
            "Agent treasury vote",
            options,
            uint64(block.timestamp),
            end,
            emptyAllowlist(),
            committee,
            2,
            encryptionPublicKey(),
            keccak256("tally-secret")
        );

        vm.prank(alice);
        ballot.setAgentDelegation(agent, end, proposalId);

        bytes memory encryptedBallot = hex"c1f3ba1107";
        bytes32 proofHash = encryptedBallotProof(encryptedBallot);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 digest =
            ballot.makeAgentBallotDigest(alice, agent, proposalId, keccak256(encryptedBallot), proofHash, 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(dave);
        ballot.submitPrivateBallotByAgent(proposalId, alice, agent, encryptedBallot, proofHash, 0, deadline, signature);

        assert(ballot.getPrivateBallotHash(proposalId, alice) == keccak256(encryptedBallot));
        assert(ballot.agentNonces(alice, agent) == 1);

        vm.expectRevert(CipherBallotCommitReveal.InvalidAgentNonce.selector);
        ballot.submitPrivateBallotByAgent(proposalId, alice, agent, encryptedBallot, proofHash, 0, deadline, signature);
    }

    function testRevokedAgentCannotSubmitPrivateBallot() public {
        string[] memory options = new string[](2);
        options[0] = "A";
        options[1] = "B";

        address[] memory committee = new address[](2);
        committee[0] = bob;
        committee[1] = carol;
        uint256 proposalId = ballot.createThresholdProposal(
            "Revoked agent",
            options,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            emptyAllowlist(),
            committee,
            2,
            encryptionPublicKey(),
            keccak256("tally-secret")
        );

        vm.prank(alice);
        ballot.setAgentDelegation(agent, uint64(block.timestamp + 1 hours), proposalId);
        vm.prank(alice);
        ballot.revokeAgentDelegation(agent);

        vm.expectRevert(CipherBallotCommitReveal.AgentNotAuthorized.selector);
        ballot.submitPrivateBallotByAgent(
            proposalId,
            alice,
            agent,
            hex"01",
            keccak256("proof"),
            0,
            uint64(block.timestamp + 30 minutes),
            new bytes(65)
        );
    }

    function testDelegationChangesInvalidateOutstandingAgentSignatures() public {
        string[] memory options = new string[](2);
        options[0] = "A";
        options[1] = "B";

        address[] memory committee = new address[](2);
        committee[0] = bob;
        committee[1] = carol;
        uint64 end = uint64(block.timestamp + 1 days);
        uint256 proposalId = ballot.createThresholdProposal(
            "Invalidate old agent instructions",
            options,
            uint64(block.timestamp),
            end,
            emptyAllowlist(),
            committee,
            2,
            encryptionPublicKey(),
            keccak256("tally-secret")
        );

        bytes memory encryptedBallot = hex"010203";
        bytes32 proofHash = keccak256("proof");
        uint64 deadline = uint64(block.timestamp + 1 hours);

        vm.prank(alice);
        ballot.setAgentDelegation(agent, end, proposalId);
        bytes32 firstDigest =
            ballot.makeAgentBallotDigest(alice, agent, proposalId, keccak256(encryptedBallot), proofHash, 0, deadline);
        (uint8 firstV, bytes32 firstR, bytes32 firstS) = vm.sign(AGENT_PRIVATE_KEY, firstDigest);
        bytes memory firstSignature = abi.encodePacked(firstR, firstS, firstV);

        vm.prank(alice);
        ballot.setAgentDelegation(agent, end + 1 hours, proposalId);
        assert(ballot.agentNonces(alice, agent) == 1);

        vm.expectRevert(CipherBallotCommitReveal.InvalidAgentNonce.selector);
        ballot.submitPrivateBallotByAgent(
            proposalId, alice, agent, encryptedBallot, proofHash, 0, deadline, firstSignature
        );

        bytes32 secondDigest =
            ballot.makeAgentBallotDigest(alice, agent, proposalId, keccak256(encryptedBallot), proofHash, 1, deadline);
        (uint8 secondV, bytes32 secondR, bytes32 secondS) = vm.sign(AGENT_PRIVATE_KEY, secondDigest);
        bytes memory secondSignature = abi.encodePacked(secondR, secondS, secondV);

        vm.prank(alice);
        ballot.revokeAgentDelegation(agent);
        assert(ballot.agentNonces(alice, agent) == 2);
        vm.prank(alice);
        ballot.setAgentDelegation(agent, end + 1 hours, proposalId);

        vm.expectRevert(CipherBallotCommitReveal.InvalidAgentNonce.selector);
        ballot.submitPrivateBallotByAgent(
            proposalId, alice, agent, encryptedBallot, proofHash, 1, deadline, secondSignature
        );
    }

    function testVoterCanSignOneTimeRelayedPrivateBallotWithoutDelegation() public {
        uint256 proposalId = createSecretProposal(emptyAllowlist());
        bytes memory encryptedBallot = hex"aabbcc";
        bytes32 proofHash = encryptedBallotProof(encryptedBallot);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 digest =
            ballot.makeVoterBallotDigest(signedVoter, proposalId, keccak256(encryptedBallot), proofHash, 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VOTER_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(dave);
        ballot.submitPrivateBallotByVoterSignature(
            proposalId, signedVoter, encryptedBallot, proofHash, 0, deadline, signature
        );

        assert(ballot.getPrivateBallotHash(proposalId, signedVoter) == keccak256(encryptedBallot));
        assert(ballot.voterBallotNonces(signedVoter) == 1);

        vm.expectRevert(CipherBallotCommitReveal.InvalidVoterNonce.selector);
        ballot.submitPrivateBallotByVoterSignature(
            proposalId, signedVoter, encryptedBallot, proofHash, 0, deadline, signature
        );
    }

    function testPublicAgentCanVoteAsItselfWithoutDelegation() public {
        uint256 proposalId = createSecretProposal(emptyAllowlist());
        bytes memory encryptedBallot = hex"0102a0";
        bytes32 proofHash = encryptedBallotProof(encryptedBallot);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 digest =
            ballot.makePublicAgentBallotDigest(agent, proposalId, keccak256(encryptedBallot), proofHash, 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(dave);
        ballot.submitPublicAgentBallot(proposalId, agent, encryptedBallot, proofHash, 0, deadline, signature);

        assert(ballot.getPrivateBallotHash(proposalId, agent) == keccak256(encryptedBallot));
        assert(ballot.publicAgentNonces(agent) == 1);
    }

    function testPublicAgentSelfVoteRejectsAllowlistedProposal() public {
        address[] memory allowlist = new address[](1);
        allowlist[0] = agent;
        uint256 proposalId = createSecretProposal(allowlist);

        vm.expectRevert(CipherBallotCommitReveal.ProposalNotPublic.selector);
        ballot.submitPublicAgentBallot(
            proposalId, agent, hex"01", keccak256("proof"), 0, uint64(block.timestamp + 1 hours), new bytes(65)
        );
    }

    function testPublicAgentSignatureCannotBeUsedAsVoterSignature() public {
        uint256 proposalId = createSecretProposal(emptyAllowlist());
        bytes memory encryptedBallot = hex"cafe";
        bytes32 proofHash = keccak256("domain-separated-proof");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 digest =
            ballot.makePublicAgentBallotDigest(agent, proposalId, keccak256(encryptedBallot), proofHash, 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_PRIVATE_KEY, digest);

        vm.expectRevert(CipherBallotCommitReveal.InvalidVoterSignature.selector);
        ballot.submitPrivateBallotByVoterSignature(
            proposalId, agent, encryptedBallot, proofHash, 0, deadline, abi.encodePacked(r, s, v)
        );
    }
}
