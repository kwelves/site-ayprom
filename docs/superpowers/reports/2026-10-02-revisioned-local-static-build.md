# Revision-fenced local static build — 2026-10-02

Scope: diagnostic-only local Next build plus full route crawl into `dist/staging`. No deployment, promotion to `dist/site`, package release, or production database change.

## Behavior

- Read `get_content_revision` via public Supabase key before `next build`, after build, and after crawl.
- Reject unavailable/malformed revision, failed build/crawl, or a revision change. Skip crawl if the version already changed during build.
- The CLI accepts only local Supabase origins on `127.0.0.1:54321`, `localhost:54321`, or the owned isolated test origin `127.0.0.1:56421`. It rejects env files that Next would read implicitly and gives children an explicit environment allowlist.
- The generated browser binding is deliberately unusable (`static-build.invalid`), so the staging output is diagnostic, not a deployable site.

## Verification

- RED: seven coordinator assertions failed before behavior existed; the CLI test failed before the command existed.
- GREEN: eight targeted tests passed.
- `npm run check`: lint, typecheck, color check, 1611 passing tests and four skips, exit 0 (before the smoke fixture's final two insertions).
- Isolated local Supabase: migrations and pgTAP passed; public revision RPC changed after a catalog write; real `next build` and full crawl succeeded after seeding one vehicle and hotspot needed by the existing homepage navigation. The temporary stack was stopped and removed.
- Successful staging: 9 routes, 9 written, zero failed; HTML, sitemap, and internal-link verification reports all `ok: true`, zero broken links.
- The first empty-database run correctly failed `crawl_failed` because the global navigation linked to a vehicle-showcase fragment absent when that section had no data. This was fixed in the isolated fixture, not hidden in the producer.

## Boundaries

- The version is checked around build/crawl only. A later catalog edit can make staged HTML stale; package selection/promotion must compare the current revision again. Existing packaging does not yet enforce this fence.
- The local fixture is much smaller than production catalog data. No remote Cloudflare behavior, live DNS, production Supabase, R2, or actual browser experience was verified by this step.
- No credentials, deploy, push, or production changes. The Next/Vercel path remains the live rollback origin.
