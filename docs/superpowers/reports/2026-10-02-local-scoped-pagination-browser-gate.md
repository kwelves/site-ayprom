# Local browser gate for category and vehicle-type pagination

This is a local-only diagnostic continuation. No production database, DNS,
Vercel, Cloudflare account, R2, `dist/site`, push, or deploy was changed.

## Scope and result

The existing isolated publication-revision smoke now seeds 30 published
fixture products in one direct category and associates them with one vehicle
type. It builds and crawls the public site, checks the package on local
workerd, and runs Playwright Chromium against the staged pages and local API.
The temporary Supabase stack was stopped and removed (`cleanup: true`).

Both `/catalog/category/revision-smoke` and
`/catalog/vehicle-type/kran-manipulyator` returned six products on page 2
when opened with `?page=2` and when the browser clicked `Вперёд` from page 1.
Each scoped API response was HTTP 200 with `page: 2` and the expected
`category` or `vehicleType` filter. All four browser checks passed; no page
errors, local HTTP errors, failed checks, or uncaptured prefetches were
recorded. The full local build/crawl wrote 39/39 routes without failure.

## Test sequence

- Unit RED: the selector for scoped query routes did not exist. GREEN: the
  category and vehicle-type paths are selected, while static and unrelated
  routes are excluded (10/10 local-browser-probe tests).
- Integration RED: the isolated smoke failed because the browser report had
  no scoped pagination checks. GREEN: the same smoke passed with real local
  Supabase, Next build, workerd, and Chromium.
- `npm run check`: exit 0; 185 test files passed, one skipped; 1638 tests
  passed, four skipped. Lint, TypeScript and color checks passed. jsdom's
  known unsupported-navigation message did not fail the suite; actual
  navigation was verified separately in Chromium.

## Still outside this proof

The data are synthetic, not the full production catalog. Brand,
subcategory, mixed-category, and admin edit/media flows were not browser-
tested in this slice. Local workerd cannot prove remote Cloudflare routing,
Worker Free CPU/quota, or Supabase Edge Function limits. The package is not
production-ready and no cutover occurred.
