# Supabase Auth as a zero-cost password verifier: local feasibility

This is a local-only diagnostic, not a production migration or deployment.
The existing Vercel admin and the shared local Supabase stack were not changed.

## Reproduction

Run `node scripts/cloudflare/local-supabase-auth-feasibility.mjs` from this checkout.
The script creates an isolated Supabase project on 564xx ports, a fictitious
Auth user, and a local workerd running the existing Supabase Auth adapter plus
the real admin handler. It uses a separate fixture admin shell and randomly
generated passwords. It stops only its own project and removes its own temporary
directory. No production keys are needed.

## Observed result, 2026-10-01

- An unauthenticated request to `/admin` was redirected to login.
- A wrong password produced no session; the correct password produced a session
  and served the fixture admin shell.
- After changing the password through Supabase Auth, the old password failed
  and the new password succeeded.
- **The previously issued Worker cookie still served `/admin` with HTTP 200
  after the password change.** This is a release blocker for treating the
  existing Auth adapter as a drop-in replacement. The adapter's session version
  is separate from the Auth user's password state, so the password change alone
  did not revoke that cookie.
- The isolated stack and temporary files were cleaned up successfully.

## Interpretation and boundary

Supabase Auth can check the password outside the Worker, avoiding an expensive
PBKDF2 password calculation in the Worker for this path. It does **not** by
itself provide the password-change/session-revocation behavior expected of the
admin. A safe implementation must link password changes to session invalidation
or explicitly accept a bounded session lifetime after a change. No such product
change was made in this probe.

The test used a real local Supabase Auth service and local workerd, but only a
fixture admin shell. It did not test real production data, Cloudflare's remote
CPU limits, deployability, the live site's routing, or the monthly free quotas.
The production Worker is still wired to the current credential-row approach,
not to this Auth adapter. No push, deploy, DNS, tariff, production database, or
Vercel changes were made.

## Next decision

Do not switch the admin login to Supabase Auth yet. First choose a revocation
rule and implement it with tests; then run a separate remote staging gate before
any production cutover. The existing Vercel admin remains the temporary origin.
