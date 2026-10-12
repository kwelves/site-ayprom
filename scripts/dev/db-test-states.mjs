// Runs the database tests in BOTH states of the expand / contract migration:
//   expand   (what production runs while the Vercel site is the rollback target): supabase/migrations + supabase/tests/database
//   contract (after Vercel is retired): the same plus supabase/contract/20261201000000_catalog_source_lockdown.sql,
//            tested with every test in supabase/tests/database except the expand-only bridge test, plus supabase/contract/tests
// It also proves the bridge test is not blind: it must FAIL once the contract step has been applied.
// Usage: node scripts/dev/db-test-states.mjs        (needs the Supabase CLI and a running Docker; resets the LOCAL database)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const CONTRACT_FILE = "20261201000000_catalog_source_lockdown.sql";
const BRIDGE_TEST = "expand_contract_bridge.test.sql";

function supabase(args, input) {
  const result = spawnSync("supabase", args, { cwd: ROOT, encoding: "utf8", shell: true, input, stdio: ["pipe", "pipe", "pipe"] });
  return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
function reset() {
  const result = supabase(["db", "reset", "--local"], "y\n");
  if (result.status !== 0) throw new Error(`db reset failed:\n${result.out.slice(-600)}`);
}
function runTests(files) {
  const result = supabase(["test", "db", ...files]);
  const summary = result.out.split(/\r?\n/).filter((line) => /^(Files=|Result:)|Failed test|Wstat/.test(line)).join("\n");
  return { ok: result.status === 0, summary };
}
const databaseTests = readdirSync(path.join(ROOT, "supabase", "tests", "database")).filter((name) => name.endsWith(".test.sql"));
const contractTests = readdirSync(path.join(ROOT, "supabase", "contract", "tests")).filter((name) => name.endsWith(".test.sql"));
const rel = (...parts) => path.posix.join(...parts);

let failed = false;
const report = (title, outcome) => {
  console.log(`\n== ${title}: ${outcome.ok ? "PASS" : "FAIL"}\n${outcome.summary}`);
  if (!outcome.ok) failed = true;
};

const temporary = path.join(MIGRATIONS, CONTRACT_FILE);
try {
  reset();
  report("expand state (production while Vercel is the rollback)", runTests(databaseTests.map((name) => rel("supabase", "tests", "database", name))));

  copyFileSync(path.join(ROOT, "supabase", "contract", CONTRACT_FILE), temporary);
  const applied = supabase(["migration", "up", "--local", "--include-all"]);
  if (applied.status !== 0) throw new Error(`contract migration failed:\n${applied.out.slice(-600)}`);
  const strict = [
    ...databaseTests.filter((name) => name !== BRIDGE_TEST).map((name) => rel("supabase", "tests", "database", name)),
    ...contractTests.map((name) => rel("supabase", "contract", "tests", name)),
  ];
  report("contract state (after Vercel is retired)", runTests(strict));

  const blind = runTests([rel("supabase", "tests", "database", BRIDGE_TEST)]);
  console.log(`\n== bridge test must fail after the contract step: ${blind.ok ? "FAIL (it passed, so it checks nothing)" : "PASS (it fails as it should)"}`);
  if (blind.ok) failed = true;
} finally {
  if (existsSync(temporary)) rmSync(temporary);
  try { reset(); } catch { /* leave the database as it is */ }
}
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS");
process.exitCode = failed ? 1 : 0;
