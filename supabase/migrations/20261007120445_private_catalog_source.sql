-- Public catalog reads are served from sealed releases, never editable source rows.
-- Revoke inherited PUBLIC privileges as well as explicit client-role privileges.
REVOKE ALL ON TABLE public.brands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.category_brands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_brands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_characteristics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_images FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_vehicle_types FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.subcategories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vehicle_hotspots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vehicle_types FROM PUBLIC, anon, authenticated;
