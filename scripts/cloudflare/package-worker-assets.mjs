#!/usr/bin/env node
// Local package for a future Cloudflare Worker plus Static Assets deploy.
// Reads dist/staging/<run>/meta/alias-worker-entry.mjs and site/.
// Writes a self-contained bundle and config. Does not deploy or upload.
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageWorkerAssets } from "./package-worker-assets-lib.mjs";

const scriptRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(scriptRepo, "src") } });
const load = (name) => import(pathToFileURL(path.join(scriptRepo, "src/cloudflare/static-build", name)).href);
const { localProbeBindings } = await load("local-browser-probe.ts");
const { readPublicContentRevision } = await load("producer/publication-revision.ts");

const stagingFlag = process.argv.indexOf("--staging");
const packageFlag = process.argv.indexOf("--package");
const stagingDir = stagingFlag === -1 ? "" : process.argv[stagingFlag + 1];
const packageDir = packageFlag === -1 ? "" : process.argv[packageFlag + 1];

if (!stagingDir || !packageDir) {
  process.stdout.write(`${JSON.stringify({ ok: false, ready: false, code: "invalid_arguments" })}\n`);
  process.exitCode = 1;
} else {
  let bindings;
  try {
    bindings = localProbeBindings(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    );
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, ready: false, code: "local_probe_invalid_binding" })}\n`);
    process.exitCode = 1;
  }
  if (bindings) {
    const result = await packageWorkerAssets({
      repoRoot: process.cwd(),
      stagingDir: path.resolve(stagingDir),
      packageDir: path.resolve(packageDir),
      readCurrentRevision: () => readPublicContentRevision({ url: bindings.SUPABASE_URL, key: bindings.SUPABASE_PUBLISHABLE_KEY }),
    });
    const summary = {
      ok: result.ok,
      ready: result.ready,
      productionReady: result.productionReady ?? false,
      code: result.code ?? null,
      rule: result.rule ?? null,
      worker: result.worker ?? null,
      assets: result.assets ?? null,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    process.exitCode = result.ready ? 0 : 1;
  }
}
