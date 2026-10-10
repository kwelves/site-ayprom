# Local Cloudflare integration checkpoint

User explicitly approved one isolated integration branch/worktree. Main and the
Claude/Cursor worktrees were not edited. No push, deploy, remote database change,
local database write, shared-service restart, or dist/site promotion occurred.

## Inputs

- main: de708af735fb0620a71d35b19c3fcf578c948c6d
- Claude: b73db021e30985eb2bd6281c20475e89be199af8
- Cursor: 20c2cc5e6d7933450eb409c4fdb4c012ee452f65
- existing origin/main: b914160b40098defbe57fa6d021e23d54341f476
- Branch: codex/cloudflare-integration
- Worktree: C:/Users/user/.codex/worktrees/ayprom-integration/site-for-kirsan
- Merge checkpoint before test reconciliation: 5909d6d067f812c88f19c6d57c5b916c84792f08

All three merges completed without textual conflicts. This is not semantic or
production acceptance. In particular, merged SQL has not been applied/tested on a
fresh isolated database in this checkpoint.

## Integration RED -> GREEN

Initial full suite: 1103 passed, 2 failed, 4 skipped. The two failing page tests
still expected MAN for compatibleBrands [man, kamaz]. Cursor's reviewed shared
getProductHref rule deliberately chooses the smallest valid slug, KAMAZ.
Only those two explicit expected URLs were corrected, with explanatory comments.
Runtime implementation, assertions and timeouts were not weakened.

Final full suite: 141 files passed, 1 skipped; 1105 tests passed, 4 skipped.
Command: npm test -- --maxWorkers=2. Exit 0.
Lint, typecheck and check:colors passed. git diff --check passed (CRLF notices only).
Graphify updated; five unsupported/empty config inputs warned, extraction succeeded.

## Real build and limited browser evidence

npm ci --no-audit --no-fund succeeded using the merged lockfile.
npm run build with AYPROM_STATIC_BUILD=1 succeeded, including all 36 prerender
tasks. Supabase URL was http://127.0.0.1:54321; its running local storage container's
ANON_KEY was supplied in process memory as NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
No .env file or production secret was copied. NEXT_PUBLIC_HERO_MEDIA_SOURCE was
supabase. Prior JWT failure did not recur; its historical root cause remains
unproven. The live REST verifier uses a JSON key configuration, so a raw HMAC
string comparison is not a valid diagnosis of a mismatch.

On an owned Next server at 127.0.0.1:3317, isolated headless Chromium verified:

- /catalog, /catalog/category/hydraulic-pumps and /catalog/category/pto: HTTP 200,
  expected H1s, no pageerror events during this smoke.
- Keyboard activation of the AY-GP110 product link opened its real product page
  with the expected H1 and no pageerror.
- Default pointer click on the overlay anchor timed out because the image area
  intercepted the pointer. This does not prove image-area navigation is broken;
  it remains a separate explicit pointer-interaction check.
- Search submission issued /api/catalog/search and received 404 from Next.
  The thin Worker is not mounted on this Next-only test origin. End-to-end search
  is NOT accepted by this smoke.

This was NOT a browser test of frozen HTML served by Cloudflare Static Assets.
No claim of clean media/network console or complete browser acceptance is made.

## Producer evidence and remaining gates

Fixture producer succeeded: 17/17 documents, 0 failed, 2 pending aliases; its
owned child was cleaned up. HTML/sitemap/link gates execute on fixture data.
No real-site crawl, asset promotion or publication was done.

Next steps: connect the real build/crawl and local Worker into one static-serving
test harness; verify search, query/history, product pointer/keyboard navigation,
redirects, asset loading and SEO against the actual artifact. Test merged SQL and
pagination on an explicitly isolated dataset: current shared local seed has 12
products and no product_vehicle_types relations, so it cannot cover page 2 and
nonempty vehicle-type listings. Do not reset or seed the shared stack silently.
