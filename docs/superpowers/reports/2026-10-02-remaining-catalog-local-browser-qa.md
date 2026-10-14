# Local browser QA for remaining catalog listing families

Scope: isolated `codex/cloudflare-integration` worktree only. No push, deploy,
DNS change, production Supabase request, or change to `dist/site`.

## Result

- The browser probe now covers `category-brand`, `subcategory`, and
  `brand-category-subcategory` query routes, in addition to category and
  vehicle-type routes. It validates the filter parameters sent to the public
  search API, opens `?page=2`, and searches for a staged product when one exists.
- The optional `--scoped-paths` argument selects only paths already present in
  the verified route manifest. It is a diagnostic sampling mode, not a release
  gate. Response-body waits are bounded; the probe prints route progress.
- A representative browser run against the existing 12-product local staging
  passed 18/18 checks, with zero page errors, local HTTP errors, or missing
  prefetches. Search on a nonempty subcategory and a brand+subcategory page
  passed. The category-brand fixture was empty, so its product search was
  explicitly skipped. All three selected page-2 responses were empty, so this
  run did not prove the Next-button transition for those three routes.
- The shared local Supabase at `127.0.0.1:54321` lacks the six-argument
  `search_catalog_products` signature used by `noSubcategory=1`: a public-key
  RPC request returned 404 / `PGRST202`. The mixed-category browser run against
  that shared database therefore failed early with a local Worker 502. This is
  an environment mismatch, not evidence of a production failure. The shared
  database was not migrated or restarted.
- The existing isolated publication-revision smoke now seeds a genuine mixed
  category: 26 direct products and one nested product. Its public RPC page 2
  returned only direct products 25 and 26 (`Content-Range: 24-25/26`). A full
  revision-fenced Next build, crawl, package, local workerd, and Chromium run
  passed. The browser report has 25/25 successful checks, including mixed
  category page 2 by URL and Next click (2 products each) and subcategory
  search, with zero page errors, local HTTP errors, or missing prefetches.
  The temporary isolated Supabase stack stopped and cleaned up successfully.

The first isolated attempt failed after the mixed-category checks, at the
existing image-click test: its newly seeded first product had no image. Adding
the fixture image made the complete second attempt pass. No application route,
catalog UI, Worker handler, SQL migration, or production configuration changed.

## Verification

- RED/GREEN unit tests for new path families, filter mapping, selected manifest
  paths, and bounded response-body waits: 14/14 targeted tests passed.
- `npm run check`: 185 test files passed, 1 skipped; 1,642 tests passed,
  4 skipped. Lint, typecheck, and color checks passed.
- `node scripts/cloudflare/local-publication-revision-smoke.mjs`: exit 0;
  12 named checks passed; cleanup true.
- `git diff --check`: exit 0 (Git emitted only LF/CRLF conversion warnings).

## Remaining gates

This is local evidence, not a Cloudflare deployment. The representative shared
fixture did not contain a nonempty category-brand listing or a nonempty page 2
for that family. The isolated mixed-category fixture covers the missing
`noSubcategory=1` path, but not every real catalog category. Remote Cloudflare
routing, real production data, admin auth, and domain cutover remain separate
gates requiring their own verification and user authorization.
