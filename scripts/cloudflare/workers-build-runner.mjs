// Future Cloudflare Workers Builds entry. Explicit build mode only.
// Never deploys, uploads versions, calls a Deploy Hook, or uses the Cloudflare API.
// A failed run leaves the previous package directory unchanged. productionReady stays false.
// The reusable implementation lives in workers-build-runner-lib.mjs.
import { DEFAULT_PINNED_PROBE, runWorkersBuildEntry } from "./workers-build-runner-lib.mjs";

function option(flag, fallback) {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? "" : process.argv[index + 1] ?? "";
  return value.trim() ? value : fallback;
}

const { outcome } = await runWorkersBuildEntry({
  env: process.env,
  argv: process.argv,
  emit: (line) => process.stdout.write(line),
  probe: { query: option("--probe-query", DEFAULT_PINNED_PROBE.query),
    expectedName: option("--probe-name", DEFAULT_PINNED_PROBE.expectedName) },
});
if (!outcome.ok) process.exitCode = 1;
