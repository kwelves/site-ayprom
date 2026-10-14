# Private confirmation state: local verified result, 2026-10-08

Plan B Task 3 can now reconcile a lost queue-confirmation reply by reading the
actual private database receipt. The external Node queue client exposes
state(token), returning only deployedRevision, deploymentIdentifier,
leaseRevision, leaseOwned and leaseValid. It returns null for an absent row;
no token, timestamp, retry details or raw backend data are returned.

The service-only read_publication_job RPC is read-only, SECURITY INVOKER,
with an empty fixed search path and bounded lock timeout. Existing service
SELECT rights are reused; no public table/function access is added. The client
requires an exact safe response and HTTP 200, bounds the request with the
existing reader, reports a fixed error and makes no automatic retry.

## TDD and evidence

- RED checkpoint: 702d456947fa81d2e72ef0290a2217956a7b1b87.
  15 client tests failed because state() was absent. The real isolated SQL
  gate had 114 existing assertions pass, then one missing-function assertion
  fail and aborted the new 16-test plan. Gate exit 1: this was not 16 executed
  failures or a passing SQL run.
- GREEN target: 22 tests passed (7 existing queue + 15 new state tests).
- Real isolated gate: four SQL suites / 130 assertions passed, exit 0;
  public HTTP 28; capture 14 with two races; private publication control 14
  with three concurrency checks; new queue state five HTTP checks.
- The new real Node probe actually confirmed a queue job through PostgREST,
  then deliberately discarded the successful reply. Reading state recognized
  the committed revision/deployment with no lease; the confirmation request
  was sent exactly once. Reads did not change updated_at. Anonymous reads were
  denied. The probe restored its own disposable queue row in finally.
- npm run check: exit 0, lint/typecheck/color contracts + Vitest;
  221 files passed / 1 skipped, 2006 tests passed / 4 skipped.
  Existing jsdom navigation notices remain; skipped tests are not passes.
- Schema and migration are byte-identical; git diff --check exit 0.
- Graphify exit 0: 5254 nodes / 10332 edges / 430 communities.
- The preceding control checkpoint's complete pinned build/browser gate passed.
  This block reran real queue/database/HTTP gates, not the full pinned build.

No real Cloudflare call, push, deploy, remote SQL, production change, shared
service restart, main-checkout edit or other-worktree edit was performed.

The coordinator is still to be connected. Next, extend its durable history with
the previous release/deployment and intent records for activation, pointer
changes, confirmation and compensation, then implement fault-tested execution.
The existing staging CLI remains local-contract only; productionReady=false.
