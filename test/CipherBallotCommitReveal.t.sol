// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CipherBallotCommitReveal} from "../src/CipherBallotCommitReveal.sol";

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
}

contract CipherBallotCommitRevealTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    CipherBallotCommitReveal private ballot;
    address private alice = address(0xA11CE);
    address private bob = address(0xB0B);
    address private carol = address(0xCA20);
    address private dave = address(0xDAE);

    function setUp() public {
        ballot = new CipherBallotCommitReveal();
    }

    function emptyAllowlist() private pure returns (address[] memory allowlist) {
        allowlist = new address[](0);
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
            "Launch vote",
            options,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            emptyAllowlist()
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
        uint256 proposalId = ballot.createProposal("Private vote", options, uint64(block.timestamp), end, emptyAllowlist());

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
        uint256 proposalId = ballot.createProposal("Reveal policy", options, uint64(block.timestamp), end, emptyAllowlist());
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
            "Members only",
            options,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            allowlist
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
            keccak256(bytes(tallySecret))
        );

        vm.prank(dave);
        ballot.submitPrivateBallot(proposalId, bytes("private-ballot-1"), keccak256("proof-1"));

        vm.warp(end + 1);

        uint256[] memory tally = new uint256[](2);
        tally[0] = 1;
        tally[1] = 0;

        vm.prank(alice);
        ballot.approveThresholdTally(proposalId, tally, "ipfs://tally-transcript", keccak256("tally-proof"), tallySecret);

        (,,,,,,,, bool finalizedAfterOne,,,) = ballot.getProposal(proposalId);
        assert(!finalizedAfterOne);

        vm.prank(bob);
        ballot.approveThresholdTally(proposalId, tally, "ipfs://tally-transcript", keccak256("tally-proof"), tallySecret);

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
            keccak256(bytes(tallySecret))
        );

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
}
