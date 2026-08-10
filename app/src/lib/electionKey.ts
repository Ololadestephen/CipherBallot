import { SigningKey, hexlify, randomBytes } from "ethers";

export type ElectionKit = {
  publicKey: string;
  privateKey: string;
  tallySecret: string;
  committeeHandoffKey: string;
};

export function generateElectionKit(): ElectionKit {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const privateKey = hexlify(randomBytes(32));
      return {
        privateKey,
        publicKey: new SigningKey(privateKey).publicKey,
        tallySecret: hexlify(randomBytes(32)),
        committeeHandoffKey: hexlify(randomBytes(32))
      };
    } catch {
      // Retry the vanishingly unlikely invalid secp256k1 scalar.
    }
  }
  throw new Error("Unable to generate a valid election key. Please try again.");
}
