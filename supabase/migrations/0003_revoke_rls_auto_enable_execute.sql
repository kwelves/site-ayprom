-- The "Enable automatic RLS" project setting creates a SECURITY DEFINER
-- event-trigger function (rls_auto_enable) that was, by default, callable
-- by anon/authenticated via the public REST RPC endpoint. It only needs to
-- fire automatically on table creation, never via a direct API call —
-- flagged by Supabase's security advisor right after the initial migration.
--
-- Revoking from anon/authenticated alone isn't enough: EXECUTE is granted
-- to the PUBLIC pseudo-role by default in Postgres, and anon/authenticated
-- inherit through it — the grant has to be pulled from PUBLIC directly.
revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from public;
