# Late local fences for the pinned catalog candidate

The pinned local build already checked the public content revision before and
after Next build, after crawl, and after packaging. It also checked the sealed
export immediately before packaging. Two late windows remained:

1. The sealed source could change while the package was being made even if the
   public revision stayed unchanged.
2. A new edit or package corruption could occur while local workerd and the
   real browser were checking the candidate.

The runner now reopens the sealed export after packaging. The command also
rechecks the public revision, sealed export, and package integrity after the
browser probe. A mismatch returns a fixed error and never accepts the new
package; the prior package remains unchanged. Diagnostic artifacts from a
failed attempt are retained rather than deleted. `productionReady` remains
false, and none of these checks publishes or activates a Cloudflare version.

RED: the new packaging-race test returned `ok: true` on the old runner.
GREEN: all 19 runner tests passed after the fence. The separate final-state
module was missing at RED and its five contract cases now pass. Its tests
cover success, stale revision, changed export, package corruption, and thrown
checks with sanitized results.

The remaining race after the very last local check must be handled by the
future release coordinator with a fresh check immediately before activation.
This is not an atomic database+Cloudflare transaction and not evidence of a
deployed public site.

Verification: isolated `--pinned-build` exited 0 (82 SQL assertions, 28 HTTP
probes, 14 capture checks, real Next build/crawl, local Wrangler/workerd and
Chromium browser); its package remained `productionReady:false`. `npm run check`
exited 0 with 1901 passing tests and 4 skipped; lint, typecheck and color checks
passed. `graphify update .` rebuilt 5082 nodes and 10074 edges.
