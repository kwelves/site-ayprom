-- Storage bucket for brand logos uploaded from the admin panel. Same
-- posture as product-images (0005/0006): public bucket serves objects via
-- their public URL without RLS, writes only ever happen through admin
-- Server Actions on the service_role key, and no select policy is added
-- (it would only grant unwanted list()/enumerate access).
insert into storage.buckets (id, name, public)
values ('brand-logos', 'brand-logos', true);
