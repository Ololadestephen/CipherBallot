import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hexlify, randomBytes } from "ethers";
import { generateElectionKeyPair } from "./lib/ballot-envelope.mjs";

const keyPair = generateElectionKeyPair();
const filename = `.cipherballot-election-kit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const outputPath = resolve(process.cwd(), filename);
const committeeTallySecret = hexlify(randomBytes(32));
const committeeHandoffKey = hexlify(randomBytes(32));
await writeFile(outputPath, `${JSON.stringify({
  format: "cipherballot-election-recovery-v1",
  warning: "Keep this file offline during voting. Import it in the creator's Committee Portal only after the deadline.",
  createdAt: new Date().toISOString(),
  encryptionPublicKey: keyPair.publicKey,
  electionPrivateKey: keyPair.privateKey,
  committeeTallySecret,
  committeeHandoffKey
}, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });

console.log(JSON.stringify({
  warning: "The election private key was written to a local owner-readable file and was not printed.",
  encryptionPublicKey: keyPair.publicKey,
  electionKitFile: outputPath
}, null, 2));
