-- Storage bucket for product photos uploaded from the admin panel. Public
-- bucket serves objects via their public URL without going through RLS, and
-- writes only ever happen through admin Server Actions using the
-- service_role key (which bypasses storage RLS entirely) — so no
-- select/insert/update/delete policy on storage.objects is needed at all
-- (a SELECT policy would only add unwanted list()/enumerate access, see
-- 0006_storage_no_listing.sql).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true);
