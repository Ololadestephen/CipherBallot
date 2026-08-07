import { readFile } from "node:fs/promises";

const mode = process.env.NODE_ENV || "production";
const envFiles = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
const unsafePattern = /^VITE_.*(PRIVATE_KEY|SECRET|API_KEY|RELAYER)/i;
const unsafeNames = new Set(Object.keys(process.env).filter((name) => unsafePattern.test(name)));

for (const path of envFiles) {
  try {
    const contents = await readFile(path, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match && unsafePattern.test(match[1])) unsafeNames.add(match[1]);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (unsafeNames.size > 0) {
  console.error(`Refusing to build with server secrets exposed through Vite: ${[...unsafeNames].sort().join(", ")}`);
  process.exit(1);
}

console.log("Public environment variable check passed.");
