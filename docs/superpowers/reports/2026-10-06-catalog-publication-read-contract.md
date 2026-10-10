# Immutable catalog read contract — local evidence

## Scope

Plan: `docs/superpowers/plans/2026-10-05-cloudflare-publication-snapshot.md`, Task 1.
Branch: `codex/cloudflare-integration`. No remote migration, push, deployment,
DNS change, or shared Supabase reset was performed.

Public page data and search can read an immutable release. Requests without a
pin use only the active ready release. Pinned requests require the matching
capability and a sealed/ready release. Unknown/revoked releases, wrong/missing
capabilities and missing active state fail closed without source-table fallback.

The public search wrapper has one eight-argument signature with optional final
arguments. Existing five/six-argument calls remain valid. Its returned columns,
filters, normalization and order are preserved. Private table grants are absent;
only explicit read function execution and schema USAGE are granted. Privileged
function bodies are in the non-exposed private schema with empty search_path.

Document size is bounded at 1 MiB, kind/key at 64/256 characters and capability
input at 256 characters. Rows are append-only during capture and cannot be
changed or extended after sealing. Release identity/capability/revision cannot
change; sealed state cannot reopen and revocation cannot be reversed.

## RED / GREEN evidence

Command: `node scripts/cloudflare/local-catalog-publication-contract.mjs`.
Each run uses a unique disposable Supabase project on 564xx ports and stops
only that project. Fixture credentials are synthetic. The shared 543xx project
was not restarted or reset. Failed stop preserves its directory for recovery.

1. Original schema: 9 structural assertions failed because release storage and
   the new function identities were absent.
2. Structural scaffolding: 11 behavioral assertions failed for missing active
   and pinned reads, denied capabilities and immutable documents. That early
   run also stopped before the role assertions; it was not a complete suite.
3. Read implementation: 35 assertions ran, 7 failed specifically for search
   still reading editable products instead of releases.
4. Search implementation: all 35 passed. The initial HTTP test expected 400 for
   SQLSTATE 55000, but real PostgREST returns 500. Corrected the HTTP expectation,
   preserving the fail-closed response and fixed safe message.
5. Identity protection tests: 5 of 42 failed before its trigger existed.
6. Final consolidated migration: **46/46 pgTAP passed**, **17 real PostgREST
   requests passed**, harness exit 0. Tested pagination 206 with `1-1/3`,
   out-of-range 416 with `*/3`, published and pinned results, no capability/hash
   in responses, private-schema 406 and private-resolver 404.
7. Local security advisor (`--type security --level error --fail-on error`):
   `results: []`, exit 0. This is not a claim about all warning-level findings.

## Migration generation

CLI 2.113.0 rejects declarative sync on this pre-pg-delta flat schema tree with
`LegacyDeclarativeNonInteractiveError`. Used the documented one-run legacy
`db diff --use-migra --schema public,catalog_private` against isolated copies.
It omitted ACL changes, so explicit GRANT/REVOKE statements were added and
verified by privileges and real public-key requests. The three intermediate,
uncommitted local migrations were replaced by one regenerated migration:
`20261005202557_catalog_publications.sql`. Their generated copies remain in
ignored scratch directories; no deployed migration was rewritten.

## Other verification

- `npm run check`: exit 0; 200 test files passed, one skipped; 1789 tests passed,
  four skipped; lint, typecheck and color check passed.
- The existing jsdom navigation warnings remain; this is not browser evidence.
- ESLint on both new harness files and `node --check`: passed after final edits.
- No new Next build or remote/browser verification was claimed for this SQL step.
- ECC 2.2.3 security-review, tdd-workflow and verification-loop were applied.

## Remaining gates (not solved by this checkpoint)

- Task 2 must atomically capture the real complete catalog and its hash, handle
  concurrent source edits, and test on realistic catalog volume. These fixtures
  do not establish capture or build correctness.
- Existing SQL suites that populate editable source tables for search must be
  adapted to capture a release using that real implementation, retaining their
  original behavior assertions. Full SQL-suite compatibility is not claimed.
- Task 3/4 must connect Next and Worker to the new reader. This migration alone
  is NOT production-deployable: without the first active release search fails
  closed. Existing public source SELECT grants are intentionally still present
  until compatible readers pass Task 5.
- Full build, source-access revocation, release activation/rollback, admin write
  wiring, remote staging and DNS cutover remain later gates. Migration unfinished.
