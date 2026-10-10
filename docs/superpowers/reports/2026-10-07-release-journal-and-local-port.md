# Release journal and local Cloudflare version port

Task 2 now has two local building blocks. `createReleaseJournal` appends
bounded JSONL records for candidate, inactive verification, old-live failure,
unresolved, published, and rollback states. Each record contains only a safe
event ID, UTC timestamp, release ID, revision, package digest, version and
deployment IDs, and a fixed reason code. Invalid records, malformed existing
content, oversized journals, and symlinked paths fail closed with fixed error
codes.

`createLocalCloudflareVersionPort` is an in-memory fake for local tests. It
keeps an uploaded version inactive until `activate` is called, provides a
preview URL for known versions, and supports explicit rollback. It never
contacts Cloudflare and stores no credentials.

TDD: journal tests started RED because the module was absent; four journal
tests now pass. The fake port started RED for the same reason; three tests now
pass. The combined publication upload contract now has twelve passing tests.
The full `npm run check` passed with 1916 tests and 4 skips; lint, typecheck,
color checks, and `git diff --check` passed.

This remains a local contract. The real Wrangler adapter, durable remote
journal storage, activation coordinator, and any Cloudflare account access are
still separate gates. No upload, deploy, DNS, Supabase production change, or
Vercel change was made.
