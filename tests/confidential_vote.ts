import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";

describe("confidential_vote", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("sanity", async () => {
    expect(provider).to.be.ok;
  });
});
