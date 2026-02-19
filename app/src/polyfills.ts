import { Buffer } from "buffer";

// Keep browser polyfills minimal and deterministic for SDKs that expect Node globals.
const g = globalThis as any;
g.global = g;
g.Buffer = g.Buffer ?? Buffer;
g.process = g.process ?? {};
g.process.env = g.process.env ?? { NODE_ENV: "development" };
g.process.argv = g.process.argv ?? [];
g.process.nextTick =
  g.process.nextTick ??
  ((cb: (...args: any[]) => void, ...args: any[]) => Promise.resolve().then(() => cb(...args)));
g.process.cwd = g.process.cwd ?? (() => "/");
g.process.version = g.process.version ?? "v18.0.0";
g.process.versions = g.process.versions ?? {};
g.process.versions.node = g.process.versions.node ?? "18.0.0";
