// Bundles the photo queue worker (src/lib/photo-queue/main.ts) into one Node file next to a tiny
// package.json, so a GitHub Actions job only has to install Sharp (native code) and run it.
// Usage: node scripts/cloudflare/build-photo-queue.mjs   ->   deploy/photo-queue/runner.mjs
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { build } from "vite";

const root = process.cwd();
const out = path.join(root, ".wrangler", "tmp", "photo-queue");
const emptyServerOnly = { name: "empty-server-only", enforce: "pre", resolveId: (id) => (id === "server-only" ? "\0server-only" : null), load: (id) => (id === "\0server-only" ? "" : null) };

await build({
  configFile: false,
  root,
  logLevel: "warn",
  publicDir: false,
  plugins: [emptyServerOnly],
  resolve: { alias: [{ find: "@", replacement: path.join(root, "src") }] },
  ssr: { external: ["sharp"], noExternal: true },
  build: {
    ssr: path.join(root, "src", "lib", "photo-queue", "main.ts"),
    outDir: out,
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { format: "es", entryFileNames: "runner.mjs", codeSplitting: false } },
  },
});
mkdirSync(path.join(root, "deploy", "photo-queue"), { recursive: true });
copyFileSync(path.join(out, "runner.mjs"), path.join(root, "deploy", "photo-queue", "runner.mjs"));
console.log(path.join(root, "deploy", "photo-queue", "runner.mjs"));
