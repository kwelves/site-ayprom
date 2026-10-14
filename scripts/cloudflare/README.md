# Local thin Worker smoke gate

This gate runs the real Cloudflare `workerd` runtime through Wrangler against an
in-process mock of the public Supabase PostgREST RPC. It never deploys a Worker
and uses only fake bindings.

## One-time local Wrangler install

Keep the pinned Wrangler tool inside the ignored `.wrangler/` directory. This
avoids changing the project dependency manifest and, on Windows, keeps the dev
watcher on the same drive as the repository.

```powershell
npm install --prefix .wrangler/tools/wrangler-4.135.0 --no-save --no-audit --no-fund wrangler@4.135.0
```

The installation command can access the npm registry. It writes only under the
ignored `.wrangler/tools/` directory.

## Run the gate

```powershell
node scripts/cloudflare/worker-smoke.mjs `
  --wrangler .wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js `
  --repeat 3
```

The runner verifies Wrangler is exactly `4.135.0`, performs a deployment
dry-run, validates the bundle allowlist and size, starts `wrangler dev --local`
on ephemeral loopback ports, and runs the HTTP contract against mock PostgREST.

Covered runtime cases:

- health without a Supabase call;
- search with every public filter and exact `ProductPage` serialization;
- publishable `apikey` with no `Authorization`, cookie, service-role, or secret header;
- PostgREST-style `offset`/`limit` pagination without a `Range` header on POST;
- empty first and later pages, including `416` with an exact `Content-Range`;
- invalid pagination normalization;
- `noSubcategory=1` (direct products of a mixed category): the RPC body gains
  `require_no_subcategory: true` only in this mode, and a page beyond the total
  keeps the exact count from `416`;
- `400 invalid_catalog_search` without an upstream call for `subcategory` plus
  `noSubcategory`, or any `noSubcategory` value other than `1`;
- upstream 5xx, missing/malformed count, oversized rows, non-JSON, and invalid rows;
- 404 and 405 behavior;
- sanitized application error logs through Local Explorer.

The runner removes its temporary state, Wrangler registry/cache files created by
the run, and newly created `.wrangler/tmp/{bundle,dev}-*` directories. It strips
Cloudflare, Supabase, and Wrangler variables inherited from the parent process,
disables metrics/error reporting, and redirects XDG configuration into the
temporary run directory.

## Run the real local PostgREST contract

Start the repository's local Supabase stack, then run the checked-in contract:

```powershell
supabase start
npm run test:cloudflare:postgrest
```

The runner obtains the local API URL and public key from `supabase status`
without printing either value. It refuses every endpoint except loopback HTTP
on port `54321`, so a production Supabase project cannot be targeted. The
integration cases verify a five-row POST page, a real out-of-range `PGRST103`,
an empty filtered page, and the `noSubcategory=1` mode through the Worker
`ProductPage` contract. The last case is schema-first: it passes only after the
`*_mixed_category_no_subcategory_search` migration is applied to the local
database (`supabase migration up`); before that PostgREST answers `PGRST202`
and the Worker returns `502`.

To check the static catalog snapshot against a real server-side row cap, run:

```powershell
node scripts/cloudflare/local-snapshot-cap-smoke.mjs
```

This creates and removes its own temporary Supabase project on ports
`56420–56429`; it does not stop the shared stack. PostgREST is configured with
`max_rows=2`, while the snapshot requests 1000 rows. Five test products must
arrive through offsets 0, 2, and 4. A successful run reports `cleanup: true`.

## Run the isolated admin product edit contract

```powershell
node --experimental-transform-types scripts/cloudflare/local-product-edit-contract.mjs
```

Needs Docker, the Supabase CLI and the pinned local Wrangler. It creates its
own temporary Supabase project on ports `56520–56529` (the shared stack on
`543xx` and other isolated stacks on `564xx` are untouched), applies every
migration, starts two local workerd instances and stops/removes everything at
the end (`cleanup: true`). The test-only entry
`tests/support/product-edit-runtime-entry.ts` composes the real handler with
the CAS update port; `src/cloudflare/worker.ts` itself stays read-only for
products, which the same run verifies. It prints only check names, never keys.

## Run the local Static Assets routing proof

```powershell
npm run test:cloudflare:assets
```

This reuses the same isolated Wrangler/workerd runner with
`wrangler.static-assets.jsonc`. The checked-in
`fixtures/cloudflare-static-assets/` directory is deliberately a tiny routing
fixture, not a production site build. It contains a conflicting
`/api/health/index.html` asset so the gate can prove that `run_worker_first`
keeps `/api/*` on the thin Worker while successful public and admin-shell
requests are served by Static Assets.

The gate also verifies an HTML `404-page`, `_headers`, content types, the
no-trailing-slash canonical URL behavior, Cloudflare Free asset-count and
25 MiB per-file limits, and the absence of
source maps, `_worker.js`, source trees, dependency trees, and environment
files from the asset manifest. A real production build directory must replace
the fixture before any staging or cutover work.

## Boundaries

- The mock reproduces the verified PostgREST 11+ behavior relevant to this
  adapter: POST pagination uses `offset`/`limit`, and an offset beyond the total
  returns `416` with `Content-Range: */<total>`. Re-run the real local contract
  above whenever the Supabase/PostgREST version changes.
- Local Explorer access traces contain complete request URLs, including search
  query parameters. The gate separately inspects only application `error` logs
  when asserting that upstream details and keys are not leaked.
- Worker Free CPU, remote bindings, isolated staging, and production routing are
  outside this local gate.
- Static Assets billing and invocation counts require isolated remote staging;
  the local asset-first gate proves routing precedence, not production quota
  accounting.
