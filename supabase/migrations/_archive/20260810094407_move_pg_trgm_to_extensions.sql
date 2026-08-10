-- 20260725163001_catalog_search_and_pagination.sql created pg_trgm without
-- naming a schema, so it landed in `public` and Supabase's security advisor
-- flags it (extension_in_public): everything in `public` is part of the
-- namespace reachable through the Data API.
--
-- `extensions` is the schema Supabase provisions for exactly this purpose and
-- it already exists both locally and on the hosted project.
--
-- Verified before applying: the three GIN trgm indexes stay valid across the
-- move (indexes reference the operator class by OID, not by name), and both
-- search_catalog_products() and refresh_product_search_text() keep working —
-- they use plain LIKE, so the planner reaches the opclass through the index
-- rather than through search_path.
--
-- Guarded so a database where the extension is already in `extensions`
-- (or absent) does not fail the migration.
do $$
begin
  if exists (
    select 1
    from pg_extension as ext
    join pg_namespace as namespace on namespace.oid = ext.extnamespace
    where ext.extname = 'pg_trgm'
      and namespace.nspname = 'public'
  ) then
    execute 'alter extension pg_trgm set schema extensions';
  end if;
end
$$;
