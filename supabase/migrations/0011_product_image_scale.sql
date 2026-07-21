-- Per-photo visual scale correction (mirrors brands.logo_scale) — some
-- product photos have more baked-in padding than others, so a per-image
-- override lets the admin make them read as equally "full" without cropping.
alter table public.product_images add column scale numeric;
