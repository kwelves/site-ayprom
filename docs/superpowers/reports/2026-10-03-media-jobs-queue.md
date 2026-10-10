# Local product-media queue checkpoint (2026-10-03)

Status: **partial, local only**. No Worker upload endpoint, R2 write, production database change, push or deploy.

## Why this exists

The external Node/Sharp processor already prepares a master and two variants, but it needs a durable handoff from an authenticated upload to publication. A crash must not lose a job, a second processor must not publish the same photo, and unfinished objects must not appear in `product_images`.

## Implemented

- `supabase/schemas/zz_product_media_jobs.sql` defines a private `product_media_jobs` queue and six service-role-only RPCs: reserve, queue, claim, fail, cancel and finish. The migration `20261003085609_product_media_jobs.sql` has identical bytes to that declarative source.
- Reservations serialize per admin-owned draft and allow at most ten active photos. Queueing serializes on the product row and counts existing plus pending photos. Claims use row locks and expiring, rotating lease tokens; a stale processor cannot complete or fail another attempt. Attempts are capped at three.
- `finish_product_media_job` validates a bounded receipt and atomically adds one `product_images` row. It does not contact R2: the future runner must verify all uploaded objects and hashes **before** calling it. The existing content-revision trigger is then advanced by the image row, not by reservation or queueing.
- RLS is enabled without public policies. Table and RPC access is granted only to `service_role`; this key must remain server-side. These RPCs do not authenticate a browser request by themselves.
- `scripts/check-declarative-schema.mjs` now compares all `supabase/schemas/*.sql` files with the local database rather than only `prod.sql`.
- `scripts/cloudflare/local-media-jobs-smoke.mjs` creates and stops only its own temporary Supabase project on ports 564xx. `--schema` tests the desired schema; the default mode tests the migration history. It uses pgTAP, concurrent loopback PostgREST requests and a real Sharp-generated receipt, without R2 or production services.

## Evidence and limits

- RED: before adding the schema, the pgTAP `has_table` assertion failed. GREEN on an isolated PostgreSQL project after applying the desired schema: 44/44 pgTAP assertions. Fifteen parallel reservations for one draft yielded exactly ten successes; fifteen parallel queue calls for one product yielded exactly ten; ten concurrent claims yielded ten distinct jobs and image orders; two concurrent completions yielded one image row. Anonymous claim was denied. Real `processProductPhoto` output was used as the completion receipt.
- `npm run check`: exit 0, 187 test files passed, one skipped; 1676 tests passed, four skipped. After removing one lint warning in the smoke script, `npm run lint` separately exited 0 without warnings. `node --check` exited 0.
- **Not yet proven:** the final migration was edited after the successful schema-mode database run. Docker Desktop stopped answering, so the default **migration-history mode**, declarative/live schema comparison and full database integration remain unverified. Matching SHA-256 of the migration and desired schema is a text check, not execution proof.
- Also not proven: R2 ticket/PUT/HEAD/hash checks, authenticated Worker integration, actual external runner lifecycle, cleanup of orphaned objects, admin browser flow, remote Cloudflare CPU/quota/routing. No site behavior changed yet.

## Required next gate

When Docker Desktop is available again, run `node scripts/cloudflare/local-media-jobs-smoke.mjs` **without** `--schema` against its new isolated project, then the live declarative schema check on an appropriately migrated isolated project. Fix any migration-order or PostgREST issues before wiring upload and runner code. Do not apply this migration to production until the complete media flow and rollback have passed on a test database and test R2 bucket.
