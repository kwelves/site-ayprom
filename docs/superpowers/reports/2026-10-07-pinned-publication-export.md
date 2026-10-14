# Pinned release export in the private builder

Local Task 3 increment. This is an in-memory export port, not a site package, publication, or production switch. The existing diagnostic Workers Build remains unchanged and still reads the mutable source.

## Result

- A Node-only parent port reads all seven public document kinds for one release ID and its capability. The capability is sent in a POST body with a publishable key and never appears in a URL, returned export or test output. Service-role keys are rejected for the public read port.
- Each kind is read in bounded 20-record pages with exact PostgREST count metadata. A changed count, missing/short page, duplicate key, malformed row, oversized payload, mismatch with the atomic capture receipt, backend failure or redirect fails closed with a fixed error and no partial export result.
- The result carries the trusted capture receipt (release ID, revision, SHA-256 and document count) plus all public documents. It does not independently reconstruct PostgreSQL's canonical content SHA, which also includes search rows; that database receipt remains the authority.

## Evidence

- TDD RED: the new export module was absent. GREEN: focused export tests passed, including pagination, service-key rejection and malformed HTTP metadata.
- Real isolated Supabase/PostgREST: 82 pgTAP assertions, 17 existing release HTTP probes, 14 capture probes, 2 observed database races, the real capture CLI, and **two real pinned exports**. The old release retained the earlier product value after a source edit; the newer release contained the later value. Security advisor returned no error findings. The isolated stack was stopped; the shared stack was not used.
- `npm run check`: exit 0; lint, typecheck, colors and 205 test files passed (1 skipped), 1862 tests passed (4 skipped).
- Graphify and staged diff check are checkpoint gates, recorded with the local commit.

## Next required

Write the export to a new local-only staging path with a file digest, load and verify it in the Next build child without passing a capability, then make all build-mode queries including `getProducts` use that pinned data. Derive crawl routes from the same export and run a real Next build/SEO smoke. This export alone is not ready to package or deploy.
