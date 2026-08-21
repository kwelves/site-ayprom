create table if not exists public.admin_credentials (
  credential_key text primary key,
  password_hash text not null,
  session_version bigint not null,
  updated_at timestamptz not null default now(),
  constraint admin_credentials_singleton_check check (credential_key = 'primary'),
  constraint admin_credentials_session_version_check check (session_version >= 2)
);

alter table public.admin_credentials enable row level security;

-- The public schema is exposed by the Data API. This table is intentionally
-- reachable only through the server-side service role; no anon/authenticated
-- policy exists, and explicit revokes neutralize legacy default privileges.
revoke all on table public.admin_credentials from public, anon, authenticated;
grant select, insert, update on table public.admin_credentials to service_role;
