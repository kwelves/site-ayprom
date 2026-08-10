-- Storage bucket for category and subcategory cover images uploaded from
-- the admin panel. Same posture as product-images/brand-logos: public
-- bucket serves objects via their public URL without RLS, writes only ever
-- happen through admin Server Actions on the service_role key, and no
-- select policy is added (it would only grant unwanted list() access).
insert into storage.buckets (id, name, public)
values ('category-images', 'category-images', true);
