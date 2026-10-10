#!/usr/bin/env node
// Explicit local-only preview. Never grants the public package's ready flag.
import path from "node:path";
import { packageAdminPreview } from "./package-worker-assets-lib.mjs";

const args = process.argv.slice(2);
const values = new Map();
let valid = args.length === 4;
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!["--staging", "--package"].includes(flag) || values.has(flag) || !value || value.startsWith("--")) valid = false;
  values.set(flag, value);
}
let result = { ok: false, ready: false, previewReady: false, productionReady: false, code: "invalid_arguments" };
if (valid) {
  try {
    result = await packageAdminPreview({
      repoRoot: process.cwd(),
      stagingDir: path.resolve(values.get("--staging")),
      packageDir: path.resolve(values.get("--package")),
    });
  } catch {
    result.code = "preview_packaging_failed";
  }
}
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = result.ok && result.previewReady === true && result.ready === false ? 0 : 1;
