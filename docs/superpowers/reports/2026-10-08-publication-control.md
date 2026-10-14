# Private publication control: local verified result, 2026-10-08

## Outcome

Plan B Task 3 now has a real private Node client and database operations for
reading the active release, marking a sealed release ready under its valid
publication lease, and atomically changing the active pointer. The pointer
operation compares the expected old release before writing; an older ready
release can be restored during compensation. No source product/media writes
or remote operations were performed.

This is a prerequisite for the coordinator, not a completed publication path.
Cloudflare activation, durable reconciliation/compensation and queue confirmation
still need to be connected. Admin mutations remain behind those prerequisites.

## TDD and verification

- RED checkpoint: `adb051d824d23e80aa2c7fb7b59a16b190d6a42d`.
  The Node suite could not import the intentionally missing implementation.
  The isolated real database reported three missing-function assertions and
  then a no-plan abort. The existing 82 SQL assertions passed; the whole RED
  gate exited 1 and was not a successful test run.
- GREEN: 18 client tests; strict bounded private RPC responses, private keys,
  fixed errors, no retries, and no public/Worker/browser imports.
- Real isolated database: 114 assertions (82 existing + 32 new), three suites,
  exit 0. Schema and migration contents are identical.
- Existing real HTTP probes: 28 publication reads; 14 capture checks and two
  capture races. New real Node control probes: 14 checks, three concurrency
  checks. Held row/advisory locks were confirmed by transaction markers;
  concurrent pointer changes had exactly one winner. Anonymous RPC calls were
  denied. Restoring an older ready release retained all release artifacts.
- `npm run check`: exit 0; lint, TypeScript, color contracts and Vitest.
  220 files passed / 1 skipped; 1991 tests passed / 4 skipped.
  Existing jsdom navigation notices were printed; skipped tests are not passes.
- `node scripts/cloudflare/local-catalog-publication-contract.mjs --pinned-build`:
  exit 0; the above database/HTTP gates plus actual pinned Next build, crawl,
  package/workerd/browser path returned packaged/ok. `productionReady:false`.
  Database advisors returned no findings. Its own disposable stack was stopped.
- Graphify update: exit 0, 5232 nodes / 10311 edges / 413 communities.
  Five expected non-node file warnings did not fail the command.
- `git diff --check`: exit 0.

An intermediate SQL-file recording error collapsed dollar delimiters and caused
three isolated startup failures. Those failed runs were not passes. The files
were repaired before the successful real database and full pinned gate above.
The harness exposes only a fixed startup error and SQLSTATE, not raw backend
error text.

## Security and limitations

The new functions have fixed empty search paths, bounded lock waits, explicit
EXECUTE rights only for service_role, and add no direct table privileges.
Readiness locks the queue lease and source revision before changing release
state. Pointer changes serialize the absent-row case and reject contention.
The Node transport uses the existing bounded request reader and keeps errors
free of raw server bodies.

The private control client runs only in the external Node publication process.
Readiness does not switch the active pointer or confirm the queue. Atomic
database pointer control does not make Cloudflare and Postgres a single
transaction; the next coordinator must journal intents, reconcile uncertain
replies against actual state, compensate failures, and verify the visible site.
Real remote staging/production separation and Cloudflare behavior remain
unverified and require separately authorized remote gates.

No push, deploy, production changes, shared-service restart, or changes to
the main checkout or other worktrees were performed.

## Next local work

Add a private, bounded queue-state read for reconciling lost confirmation replies,
then connect durable publication coordination, activation and compensation.
Keep RED and GREEN checkpoints separate and preserve local artifacts.
