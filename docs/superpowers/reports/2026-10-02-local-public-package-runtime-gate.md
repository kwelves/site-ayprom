# Local public package runtime gate — 2026-10-02

Local-only continuation of the public catalog revision gate. No push, deploy, DNS change, production Supabase write, or `dist/site` promotion.

## Result

- `checkLocalPublicRelease` verifies the package inventory and public catalog revision, starts the packaged Worker on local workerd, requires health/search/product alias/static HTML responses, then verifies integrity and revision again. It returns `productionReady: false`; it does not publish or persist a selection.
- The real runtime probe now runs an exact temporary copy of a verified package. Wrangler wrote `.wrangler/tmp` beside the package config, so the previous probe itself invalidated the original package inventory. The original remains untouched; the temporary copy is removed after the probe.
- The isolated smoke seeds one published product, runs a real Next static build and crawl, packages the result, checks its local Worker and Static Assets, then changes the catalog and confirms the old package is refused before Worker startup.
- Local build failure diagnostics now include a redacted tail of the Next output so future failures can be identified without echoing the public key.

## Evidence

- TDD: new orchestration tests failed 3/4 before implementation and passed 4/4 afterward. The package runtime regression test failed with `extra_file` before the temporary-copy fix and passed afterward.
- `node scripts/cloudflare/local-publication-revision-smoke.mjs`: exit 0. Migrations and pgTAP, real Next build and crawl, package, local workerd health/search/308 alias/static HTML, before/after revision checks, stale rejection, and temporary-stack cleanup all passed.
- `npm run check`: exit 0; 185 test files passed, one skipped; 1634 tests passed, four skipped. Lint, TypeScript and color checks passed. jsdom emitted its known unsupported-navigation warning without failing tests.

## Limits and next gate

- This proves a small isolated local catalog, not the complete production catalog, Cloudflare's remote routing, Worker Free quotas/CPU, browser behavior of the deployed site, or admin parity. No public selection or promotion occurred.
- The package inventory is not a signature and there remains a time window after the last revision check. Actual publication must repeat integrity and revision checks at its own boundary and requires separate user approval. Keep Vercel as rollback origin.
