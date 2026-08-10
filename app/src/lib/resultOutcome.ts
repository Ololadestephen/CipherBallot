import type { ProposalView } from "./evm";

export type FinalResult = {
  kind: "winner" | "tie" | "no-votes";
  label: string;
  voteCount: number;
  winningOptions: string[];
};

export function getFinalResult(proposal: ProposalView): FinalResult | null {
  if (!proposal.finalized) return null;

  const tally = proposal.options.map((_, index) => proposal.finalTally[index] || 0);
  const total = tally.reduce((sum, votes) => sum + votes, 0);
  if (total === 0) {
    return { kind: "no-votes", label: "No votes cast", voteCount: 0, winningOptions: [] };
  }

  const voteCount = Math.max(...tally);
  const winningOptions = proposal.options.filter((_, index) => tally[index] === voteCount);
  if (winningOptions.length > 1) {
    return {
      kind: "tie",
      label: `Tie: ${winningOptions.join(" / ")}`,
      voteCount,
      winningOptions
    };
  }

  return { kind: "winner", label: winningOptions[0], voteCount, winningOptions };
}
