-- The "Enable automatic RLS" project setting creates a SECURITY DEFINER
-- event-trigger function (rls_auto_enable) that was, by default, callable
-- by anon/authenticated via the public REST RPC endpoint. It only needs to
-- fire automatically on table creation, never via a direct API call —
-- flagged by Supabase's security advisor right after the initial migration.
--
-- Revoking from anon/authenticated alone isn't enough: EXECUTE is granted
-- to the PUBLIC pseudo-role by default in Postgres, and anon/authenticated
-- inherit through it — the grant has to be pulled from PUBLIC directly.
-- Guarded by an existence check: rls_auto_enable() is created by the hosted
-- Supabase platform, not by these migrations, so it is absent from a local
-- `supabase start` stack. Without the guard `supabase db reset` fails here and
-- the whole migration set cannot be verified from scratch. On the hosted
-- project the function exists and both revokes run exactly as before.
do $$
begin
  if exists (
    select 1
    from pg_proc as proc
    join pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from anon, authenticated';
    execute 'revoke execute on function public.rls_auto_enable() from public';
  end if;
end
$$;
