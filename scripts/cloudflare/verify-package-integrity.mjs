#!/usr/bin/env node
// Read-only check that a local package still matches its inventory.
// This is not a signature and it never deploys.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyPackageIntegrity } from "./package-integrity.mjs";

export function runIntegrityCli(args, hooks = {}) {
  const write = hooks.write ?? ((line) => process.stdout.write(line));
  const verify = hooks.verify ?? verifyPackageIntegrity;
  try {
    const packageFlag = args[0] === "--package" ? args[1] : "";
    if (args.includes("--deploy") || args.length !== 2 || !packageFlag) {
      write(`${JSON.stringify({ ok: false, code: "invalid_arguments" })}\n`);
      return 1;
    }
    const result = verify(path.resolve(packageFlag));
    const summary = result?.ok === true
      ? { ok: true }
      : { ok: false, code: "package_integrity_failed", rule: result?.rule === undefined ? "read_failed" : result.rule };
    write(`${JSON.stringify(summary)}\n`);
    return result?.ok === true ? 0 : 1;
  } catch {
    write(`${JSON.stringify({ ok: false, code: "package_integrity_failed", rule: "read_failed" })}\n`);
    return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  process.exitCode = runIntegrityCli(process.argv.slice(2));
}
