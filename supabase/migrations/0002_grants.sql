-- We deliberately disabled "Automatically expose new tables" when creating
-- the project (Data API access is opt-in per table for safety) — that
-- setting only grants access on tables that exist at the time it's toggled,
-- so tables created by migration 0001 need these grants explicitly.
--
-- service_role bypasses RLS entirely but still needs the underlying SQL
-- GRANT to touch a table at all — this is that base-level grant. anon/
-- authenticated get SELECT only; the RLS policies from 0001 further narrow
-- what rows they can actually see (e.g. published = true on products).

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant select on all tables in schema public to anon, authenticated;

-- So tables created after this migration (if any) inherit the same grants
-- automatically, without needing a follow-up migration each time.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select on tables to anon, authenticated;
