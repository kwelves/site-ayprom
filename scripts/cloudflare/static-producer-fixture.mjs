#!/usr/bin/env node
// Fixture-mode static producer.
//
//   node scripts/cloudflare/static-producer-fixture.mjs [--repo-root <dir>] [--staging-root <dir>]
//        [--snapshot <json>] [--site-url <origin>] [--git-sha <sha>] [--concurrency <n>]
//        [--next-static <dir>] [--public-repo <dir>] [--server-arg <arg>]...
//
// --next-static copies that real directory to staging/site/_next/static.
// --public-repo copies only git-tracked public/ files referenced by the crawled
// HTML, CSS, or metadata. Without these flags the crawl stays documents-only.
// The result is still not a deployable site: client search and browser checks are later.
//
// Starts the loopback fixture server as a child process, crawls the routes
// derived from the checked-in synthetic snapshot into a fresh
// dist/staging/<id>/ directory and writes meta/route-manifest.json and
// meta/crawl-report.json there. It never touches dist/site, needs no Supabase,
// no Next build and no environment file, and prints one JSON summary line.
// Exit code 0 only when every route was captured and the child stopped cleanly.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.features.typescript !== "strip" && process.features.typescript !== "transform") {
  process.stderr.write(
    "static-producer-fixture: this CLI needs Node with built-in TypeScript type stripping (Node 22.18+ or 24+).\n",
  );
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
register("./static-producer-loader.mjs", {
  parentURL: import.meta.url,
  data: { srcRoot: path.join(repoRoot, "src") },
});

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => controller.abort());
}

const { runFixtureCli } = await import(
  pathToFileURL(path.join(repoRoot, "src", "cloudflare", "static-build", "producer", "cli.ts")).href
);

try {
  const exitCode = await runFixtureCli(process.argv.slice(2), {
    cwd: process.cwd(),
    write: (line) => process.stdout.write(`${line}\n`),
    signal: controller.signal,
  });
  process.exitCode = exitCode;
} catch (error) {
  // Only the error class and code are printed; messages may embed paths or values.
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  process.stdout.write(`${JSON.stringify({ ok: false, code: "producer_crashed", errorName: error?.name ?? "Error", errorCode: code })}\n`);
  process.exitCode = 1;
}
