CREATE TABLE public.admin_auth_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  scope text NOT NULL CHECK (scope IN ('login', 'password-change')),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  attempt_key_hash text NOT NULL CHECK (length(attempt_key_hash) = 64)
);

CREATE INDEX admin_auth_events_occurred_at_idx
  ON public.admin_auth_events (occurred_at DESC);
CREATE INDEX admin_auth_events_attempt_key_idx
  ON public.admin_auth_events (attempt_key_hash, occurred_at DESC);

ALTER TABLE public.admin_auth_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_auth_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.admin_auth_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_auth_events TO service_role;
GRANT UPDATE ON SEQUENCE public.admin_auth_events_id_seq TO service_role;

DROP FUNCTION public.register_admin_login_attempt(text, boolean);

CREATE FUNCTION public.register_admin_login_attempt(
  attempt_key_hash text,
  password_is_valid boolean,
  attempt_scope text DEFAULT 'login'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
declare
  current_row public.admin_login_rate_limits%rowtype;
  attempt_at timestamptz := clock_timestamp();
  next_failed_count integer;
  next_window_started_at timestamptz;
  next_blocked_until timestamptz;
begin
  if attempt_scope not in ('login', 'password-change') then
    raise exception 'invalid admin login attempt scope' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(attempt_key_hash, 0));

  select *
  into current_row
  from public.admin_login_rate_limits
  where key_hash = attempt_key_hash
  for update;

  if found and current_row.blocked_until is not null and current_row.blocked_until > attempt_at then
    insert into public.admin_auth_events (scope, outcome, attempt_key_hash)
    values (attempt_scope, 'blocked', attempt_key_hash);
    return greatest(1, ceil(extract(epoch from (current_row.blocked_until - attempt_at)))::integer);
  end if;

  if password_is_valid then
    delete from public.admin_login_rate_limits where key_hash = attempt_key_hash;
    insert into public.admin_auth_events (scope, outcome, attempt_key_hash)
    values (attempt_scope, 'success', attempt_key_hash);
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

  insert into public.admin_auth_events (scope, outcome, attempt_key_hash)
  values (
    attempt_scope,
    case when next_blocked_until is null then 'failure' else 'blocked' end,
    attempt_key_hash
  );

  if next_blocked_until is not null then
    return ceil(extract(epoch from (next_blocked_until - attempt_at)))::integer;
  end if;

  return 0;
end;
$function$;

REVOKE ALL ON FUNCTION public.register_admin_login_attempt(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_admin_login_attempt(text, boolean, text) TO service_role;
