# Local Static Assets + Worker browser probe

## Scope and result

This checkpoint tests a deliberately partial real-site artifact on the isolated
`codex/cloudflare-integration` worktree. It captures the real `/catalog` page and
one real product page from an `AYPROM_STATIC_BUILD=1` Next build, copies the
referenced Git-tracked public files and validated `.next/static` files into a
fresh `dist/staging/<id>/site`, stops Next, and opens the two pages through
local Wrangler/workerd in an isolated Chromium browser. The Worker uses only
the running local Supabase origin (`127.0.0.1:54321`) and its anon key.

The successful run captured 2 HTML pages and 85 static/public assets. Browser
checks passed for search (HTTP 200, one matching product), URL query state,
search after a full reload, empty search (HTTP 200), product navigation by
keyboard and by clicking its image. Page JavaScript errors: 0. Unexpected
same-origin HTTP errors for the captured pages, assets and API: 0. Next's
automatic prefetch attempted 41 other pages that this intentionally partial
artifact does not contain; their 404s are recorded separately. The browser
test therefore does not certify a complete static site or complete link graph.

## Findings and fixes

- The real R2 build previously left a loopback Supabase hero-video fallback in
  a client JS chunk. The artifact policy correctly rejected it. The R2 choice
  is now a build-time branch, so the unused fallback is absent from the R2
  artifact; the ordinary Supabase mode still uses the old helper.
- The public-asset scanner treated quoted strings inside Next's inline
  executable scripts as file URLs, inventing `/$` and `/&` and rejecting the
  real HTML. It now masks executable script bodies with parse5 source
  locations, while preserving real HTML attributes, CSS URLs and JSON-LD.
  Regression tests were observed RED before this change and GREEN after it.
- ESLint previously scanned ignored generated `dist/staging` assets (over
  10,000 findings). `dist/**` is now excluded from source linting. Artifact
  validation still checks the generated files separately.
- The diagnostic Worker configuration originally placed an explicit tsconfig
  path in a nested staging file. Wrangler could not resolve it. Removing that
  unnecessary override let Wrangler use the project's normal tsconfig.
- A URL change can precede the final React DOM swap during product navigation.
  The browser probe now waits for exactly one expected H1 before judging the
  transition; it does not accept an intermediate screen.

## Verification

- `npm run lint`, `npm run typecheck`, `npm run check:colors`: exit 0.
- `npm test -- --maxWorkers=2`: 142 files passed, 1 skipped;
  1114 tests passed, 4 skipped; exit 0. jsdom's expected unsupported
  navigation warning remains in test output; real browser navigation is
  covered by this probe.
- `npm run build` with `AYPROM_STATIC_BUILD=1`, local Supabase anon key and R2
  public media URL: exit 0; all 36 static page-generation tasks completed.
- Fixture static-assets workerd smoke: 31/31 checks passed. Thin Worker bundle
  measured 11,753 bytes raw / 3,234 bytes gzip, 4 inputs.
- Real two-page local workerd/Chromium probe: exit 0; 6 checks passed; 41
  uncaptured prefetches noted; both owned child servers stopped. The most recent
  report is under ignored `dist/staging/20260925T045957Z-803c7da6/meta/`.
- `git diff --check` and Graphify were run before the local checkpoint.

The probe is reproducible with
`node scripts/cloudflare/local-browser-probe.mjs <absolute-path-to-wrangler.js>`
after a local static build. Supply `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in process memory from the running local
stack. The probe rejects remote URLs and service-role keys, blocks external
browser requests, writes only to ignored staging, removes its temporary
Wrangler config, and never promotes `dist/site`.

## Still open

The full route manifest has not been crawled from a real local snapshot and
the real SEO/sitemap/link gates have not run on the complete site. The shared
local seed contains only 12 products and no product-vehicle-type relations,
so it cannot prove a nonempty vehicle listing or page-two pagination. Pending
product-alias redirects, headers/cache rules, admin/auth migration, the full
static artifact and a remote staging run are not accepted by this probe.
No push, deployment, DNS change, R2 write or production Supabase change was made.
