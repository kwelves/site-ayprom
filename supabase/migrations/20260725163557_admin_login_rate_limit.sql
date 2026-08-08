create table public.admin_login_rate_limits (
  key_hash text primary key,
  failed_count integer not null default 0 check (failed_count >= 0),
  window_started_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  blocked_until timestamptz
);

alter table public.admin_login_rate_limits enable row level security;
revoke all on table public.admin_login_rate_limits from anon, authenticated;
grant all on table public.admin_login_rate_limits to service_role;

create index admin_login_rate_limits_last_attempt_idx
  on public.admin_login_rate_limits (last_attempt_at);

create or replace function public.register_admin_login_attempt(
  attempt_key_hash text,
  password_is_valid boolean
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_row public.admin_login_rate_limits%rowtype;
  -- Deliberately not named `current_time`: that is a reserved SQL keyword, and
  -- inside SQL expressions the parser resolves it to CURRENT_TIME (timetz)
  -- rather than to the local variable, making every comparison below fail with
  -- SQLSTATE 42883 — which the caller mistakes for "RPC not deployed yet".
  attempt_at timestamptz := clock_timestamp();
  next_failed_count integer;
  next_window_started_at timestamptz;
  next_blocked_until timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(attempt_key_hash, 0));

  select *
  into current_row
  from public.admin_login_rate_limits
  where key_hash = attempt_key_hash
  for update;

  if found and current_row.blocked_until is not null and current_row.blocked_until > attempt_at then
    return greatest(1, ceil(extract(epoch from (current_row.blocked_until - attempt_at)))::integer);
  end if;

  if password_is_valid then
    delete from public.admin_login_rate_limits where key_hash = attempt_key_hash;
    return 0;
  end if;

  if not found or current_row.window_started_at < attempt_at - interval '15 minutes' then
    next_failed_count := 1;
    next_window_started_at := attempt_at;
  else
    next_failed_count := current_row.failed_count + 1;
    next_window_started_at := current_row.window_started_at;
  end if;

  next_blocked_until := case
    when next_failed_count >= 5 then attempt_at + interval '15 minutes'
    else null
  end;

  insert into public.admin_login_rate_limits (
    key_hash,
    failed_count,
    window_started_at,
    last_attempt_at,
    blocked_until
  )
  values (
    attempt_key_hash,
    next_failed_count,
    next_window_started_at,
    attempt_at,
    next_blocked_until
  )
  on conflict (key_hash) do update
  set failed_count = excluded.failed_count,
      window_started_at = excluded.window_started_at,
      last_attempt_at = excluded.last_attempt_at,
      blocked_until = excluded.blocked_until;

  if next_blocked_until is not null then
    return ceil(extract(epoch from (next_blocked_until - attempt_at)))::integer;
  end if;

  return 0;
end;
$$;

revoke execute on function public.register_admin_login_attempt(text, boolean)
  from public, anon, authenticated;
grant execute on function public.register_admin_login_attempt(text, boolean)
  to service_role;
