# Local Cloudflare browser gate with a nonempty second catalog page

This is a local diagnostic, not a production release or a full-catalog proof.
The live site, shared Supabase stack, DNS, Vercel, Cloudflare account, and
`dist/site` were not changed.

## Result

- An isolated temporary Supabase stack held 30 published fixture products.
  Its temporary database was removed after the run (`cleanup: true`).
- The revision-fenced Next build and full crawl passed. The final staging
  report had 39 written routes, 0 failed routes, and 30 pending product aliases.
  The sitemap, HTML/SEO, and internal-link reports passed.
- A local workerd served the staged files and API to Chromium. The direct
  `/catalog?page=2` URL and clicking `Вперёд` from `/catalog` each returned
  HTTP 200 with 6 products on page 2. Search, search after reload, empty
  search, keyboard navigation, image click, aliases, and security headers
  passed. Chromium recorded 0 page errors, 0 local HTTP errors, and 0
  uncaptured prefetches.
- The isolated publication-revision smoke returned `ok: true`, including
  rejection of stale packages after a catalog change.

## Regression found and fixed

The first 30-product crawl found a stale sitemap with only one product.
Next's persistent fetch cache still held an earlier response from the same
loopback Supabase URL. Each diagnostic revisioned build now sends a random,
validated cache nonce in its public Supabase requests. The ordinary
Next/Vercel client does not send it. A repeated isolated build then produced
the complete sitemap.

The browser probe also assumed that every product URL contained a brand or
subcategory segment. The fixture's direct-category product exposed that
limitation; the probe now recognises both direct and nested product URLs.
The fixture gained a tracked local image so its image-navigation check is
meaningful. The second-page click is now an explicit browser check.

## Verification and limits

- Targeted tests: 14/14; full `npm run check`: 1637 passed, 4 skipped, exit 0.
  Two lint warnings in the newly added test were removed afterward and that
  file passed a targeted ESLint run.
- The isolated smoke includes a successful real Next build, crawler, local
  package/runtime checks, and Chromium. It did not use production data or
  exercise remote Cloudflare routing, Free-plan CPU/quota, production media,
  or the admin login. Those remain separate gates before a cutover.
- No push, deploy, DNS change, or production write was performed.
