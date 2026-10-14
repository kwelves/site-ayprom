#!/usr/bin/env node
// Read-only local package check. It never starts Worker or deploys anything.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePublicPackage } from "./resolve-public-package.mjs";

const scriptRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(scriptRepo, "src") } });
const load = (name) => import(pathToFileURL(path.join(scriptRepo, "src/cloudflare/static-build", name)).href);
const { localProbeBindings } = await load("local-browser-probe.ts");
const { readPublicContentRevision } = await load("producer/publication-revision.ts");

let result;
if (process.argv.length !== 4 || process.argv[2] !== "--package" || process.argv.includes("--deploy")) {
  result = { ok: false, code: "invalid_arguments" };
} else {
  let bindings;
  try {
    bindings = localProbeBindings(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    );
  } catch {
    result = { ok: false, code: "local_probe_invalid_binding" };
  }
  if (bindings) {
    result = await resolvePublicPackage({
      repoRoot: process.cwd(),
      packageName: process.argv[3],
      readCurrentRevision: () => readPublicContentRevision({ url: bindings.SUPABASE_URL, key: bindings.SUPABASE_PUBLISHABLE_KEY }),
    });
  }
}
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.ok ? 0 : 1;
