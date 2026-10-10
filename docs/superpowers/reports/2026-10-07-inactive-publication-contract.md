# Local contract for staging an inactive version

This is the first, abstract part of release-plan Task 2. `CloudflareVersionPort`
describes upload, preview, current deployment, activation and rollback.
`stageInactiveCandidate` calls only upload/preview/current-deployment ports;
it never calls activation or rollback. Tests use in-memory fakes. No real
Cloudflare adapter, CLI entry, durable journal or network call was added.

The input package must pass the supplied inspection with the exact release
ID, revision, release digest and package digest, and stay non-production-ready.
A successful preview is accepted only if the active deployment is unchanged
and the supplied journal port confirms recording the event.

A lost or malformed upload response is unresolved: an inactive version may
exist, so automatic retry would be unsafe. A failed known preview is reported
as `failed_old_live` only after re-reading and confirming the prior deployment.
Concurrent deployment changes or unavailable reconciliation remain unresolved.
Fixed results do not include exception text, preview URLs or credentials.

TDD: the module was absent at initial RED. Additional RED cases caught lost
upload replies being labelled as ordinary failure and malformed/credentialed
preview URLs reaching the probe. The contract rejects those cases now.
Eight tests cover normal order, mismatched package identity, lost replies,
preview failure, unavailable/concurrent deployment state, duplicate version
identity, journal failure, and malformed URLs.

Pending Task 2 work: real bounded package inspection/digest, durable release
journal with failure states and timestamps, CLI, least-privilege Wrangler
adapter verified against installed help, remote preview-binding policy, and
local runtime integration. Nothing here proves a Cloudflare upload or public
routing. The next coordinator must recheck revision immediately before
activation and reconcile unknown state before any retry.

Verification: `npm run check` exited 0; 1909 tests passed and 4 were skipped.
Lint, typecheck and color checks passed. The new module is not wired to the
build command, so no additional real build was claimed for this abstract port.
