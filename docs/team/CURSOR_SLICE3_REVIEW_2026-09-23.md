# Slice 3: independent acceptance review

Reviewed Cursor HEAD: `e5c0ee5a1b67f6430fe24193606b18af63e7aa13`.
Branch: `codex/cursor-canonical`; working tree clean at review start.
No merge, push, deploy, production access or application edits performed.

## Verified

All four producer suites passed independently: 43/43 tests, exit 0,
using `npx vitest run tests/cloudflare-static-producer-staging.test.ts
tests/cloudflare-static-producer-run.test.ts
tests/cloudflare-static-producer-crawl.test.ts
tests/cloudflare-static-producer-cli.test.ts --maxWorkers=2`.

Real fixture crawls produced 17 documents and two pending aliases. This is
staging-only HTML, not a deployable site. No full suite/build acceptance is
claimed by this review. Cursor's reported full-suite result is separate evidence.

## Blocking findings (reproduced)

### P1: staging can resolve outside the repository

`producer/run.ts` passes the lexically validated outputRoot to
`createStagingDirectory`. `producer/staging.ts` creates that root and its child
directories without validating their real paths against the repository/dist.
When `repo/dist/staging` is a junction to a separate `outside` directory, the
fixture run returns exit 0 / ok:true and writes all 17 documents outside dist.
The later site-relative check trusts the already escaped site root.

### P1: final artifact directory is accepted as a staging root

`--staging-root <repo>/dist/site` passes preflight. The fixture run returns
exit 0 and creates a complete timestamped staging tree within dist/site.
An existing marker file remains intact, but the final artifact tree changes;
this violates the explicit no-touch boundary even without overwriting files.
Reject dist/site and its descendants, including equivalent resolved aliases.

### P2: external directories are created before junction rejection

In `writeStagingFile`, recursive mkdir(parent) runs before realpath validation.
With site/catalog pointing to outside, writing
`catalog/created-before-validation/page.html` throws staging_path_escape but
still creates outside/created-before-validation. No file is written, yet the
operation has an out-of-bounds side effect.

## Evidence and retention

Reproduction helper (local, ignored):
`C:/Erkin/site-for-kirsan/dist/agent-handoffs/review-cursor-producer.mjs`.
It imports the reviewed worktree modules and uses only fresh temporary fixture
directories and owned loopback servers. No production environment is loaded.

Latest retained fixture tree:
`C:/Users/user/AppData/Local/Temp/ayprom-codex-producer-review-tsl6WT`.
Earlier two-case run:
`C:/Users/user/AppData/Local/Temp/ayprom-codex-producer-review-i42bfc`.
These were intentionally left for diagnostics; no cleanup of user data occurred.

## Secondary observations, not additional reproduced blockers

- Windows runTaskkill awaits its helper without a timeout; the configured stop
  timeout only wraps the subsequent child-exit wait. This merits a focused
  lifecycle test before real Next integration.
- Startup catch discards the stop result; startup primary failure and cleanup
  failure cannot both be reported by that path.
- Some filesystem/report errors occur outside the typed-result catch. Review
  their error contract during subsequent lifecycle hardening.

Acceptance: hold integration pending the three path-boundary fixes and tests.
The original architectural choice and file ownership remain unchanged.

## Follow-up review: Cursor commit 0ee6041

Cursor added root path validation before staging mkdir and checks staging again
before writing the manifest or starting the child. Nested file parents are now
created one level at a time after the existing parent is checked. Cursor's
worktree was clean when independently reviewed.

The original three repros were run again against the new commit. `dist/site`
was rejected with exit 1 and left byte/layout unchanged. A junction at
`dist/staging` was rejected with exit 1 and no outside writes. A nested junction
was rejected before creating an outside directory. The full five-file producer
test selection passed independently: 50/50 tests, exit 0. Cursor reported a
full suite pass, but that full suite was not repeated by Codex in this review.

The reported concurrent junction replacement race is still possible between
filesystem checks and mkdir; this implementation does not claim a race-free
filesystem security boundary against a process that can modify the staging
tree at the same time. The three reproduced ordinary path-boundary bugs are
closed locally. The worktree has not been integrated or deployed.
