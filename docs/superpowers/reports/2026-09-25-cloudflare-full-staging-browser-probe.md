# Full staging browser probe through local workerd

The existing local browser probe now accepts `--existing-site` for a verified
`dist/staging/<id>/site` directory. The path must be exactly inside this
repository's staging tree; the real-path check rejects junction/symlink
parents and `dist/site`. The probe verifies the existing crawl, HTML, sitemap
and link reports before starting its own local Wrangler/workerd process. It
does not start Next, rebuild, change site files, promote to `dist/site`, or
contact production services. External browser requests are blocked.

On the complete local snapshot artifact
`dist/staging/20260925T052923Z-d8f88b11/site`, all six existing browser
checks passed: catalog search (HTTP 200, matching item), query state, search
after full reload, empty search (HTTP 200), keyboard navigation to a product,
and product-image click navigation. Browser JavaScript errors: 0. Unexpected
same-origin HTTP errors: 0. Uncaptured prefetch errors: **0**, down from 41 in
the earlier two-page diagnostic. The local workerd child was stopped and the
temporary Wrangler config containing the local public key was removed. The
sanitized result is `meta/browser-probe-full.json`.

This confirms those user journeys on the 90-route local artifact, not a
production release. Twelve `/product/<slug>` redirects are still pending;
the Worker is currently routed first only for `/api/*`. Admin/auth, a nonempty
vehicle-type listing, page-two pagination, remote staging and production
deployment remain unverified. No push, merge, deploy, DNS or production data
changes were made.
