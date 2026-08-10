-- Recorded on the hosted project as its own migration; 0003 also carries this
-- statement, and `revoke` is idempotent, so applying both is harmless.
--
-- Guarded for the same reason as 0003: rls_auto_enable() belongs to the hosted
-- Supabase platform and does not exist in a local `supabase start` stack.
do $$
begin
  if exists (
    select 1
    from pg_proc as proc
    join pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public';
  end if;
end
$$;
