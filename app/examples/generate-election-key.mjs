import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateElectionKeyPair } from "./lib/ballot-envelope.mjs";

const keyPair = generateElectionKeyPair();
const filename = `.cipherballot-election-kit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const outputPath = resolve(process.cwd(), filename);
await writeFile(outputPath, `${JSON.stringify({
  warning: "Keep this file off-chain and share it only through the committee's secure process.",
  encryptionPublicKey: keyPair.publicKey,
  electionPrivateKey: keyPair.privateKey
}, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });

console.log(JSON.stringify({
  warning: "The election private key was written to a local owner-readable file and was not printed.",
  encryptionPublicKey: keyPair.publicKey,
  electionKitFile: outputPath
}, null, 2));
