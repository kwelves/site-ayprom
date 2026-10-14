# Local public package revision gate — 2026-10-02

Local-only follow-up to `2026-10-02-revisioned-local-static-build.md`. No push, deploy, DNS change, production Supabase write, or `dist/site` promotion.

## Implemented

- A successful revision-fenced crawl writes one `meta/publication-revision-report.json` under its newly created staging run. Failed or stale crawls do not get a success report; existing reports are never overwritten.
- The public Worker/Static Assets packager requires that report and rereads the current revision through an injected public-RPC reader before bundling, after bundling, and before writing the ready manifest. Missing or changed revisions fail closed with fixed codes. Admin-preview packaging remains separate.
- A public package carries `sourceRevision` in its manifest and a `source-revision.json` file covered by the existing SHA-256 inventory. `productionReady` remains false.
- `resolve-public-package-cli.mjs --package <name>` performs a read-only, local-only check of the package inventory and current public revision. It does not write a selection, start a Worker, or deploy. Both package and resolver CLIs accept only the local Supabase loopback origins from `localProbeBindings`; service-role is not used for public revision reads.

## Evidence

- TDD: stale, missing, unavailable and during-packaging revision cases, report-write failure, manifest-only version edit and remote-source rejection were observed failing before fixes; targeted package, report and resolver tests passed afterward.
- `npm run check`: exit 0; 184 files passed, one skipped; 1630 tests passed, four skipped. Lint, typecheck and color checks passed.
- Isolated local Supabase smoke: migrations and pgTAP passed; real Next build and crawl succeeded; current package was created and read-only resolved; after a local catalog edit a new package was refused before writing and the already-built package was refused by resolver. The temporary stack was stopped and removed.
- Example fixture package: 84 static assets; Worker 71,273 bytes raw / 16,501 bytes gzip; `sourceRevision: 3`; `productionReady: false`. This is not a production size measurement.

## Limits

- The inventory detects accidental changes but is not a signature; a hostile writer who can replace both files and manifest remains out of scope. There is still a time window after the final revision read and before any future publication. A future promotion/cutover gate must reread revision and verify package integrity at that point.
- The resolver is read-only. There is no public package selection state, automatic publication, rollback switch, remote Cloudflare routing proof, or full production-catalog browser test.
- Existing Next/Vercel production remains untouched and is still the live site/rollback origin.
