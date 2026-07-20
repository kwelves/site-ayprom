-- Product-level "which type of specialized machinery does this fit"
-- classification (dump truck / tractor unit / crane-manipulator, etc.) —
-- the replacement for the removed brands.relation split (see
-- 0009_remove_brand_relation.sql's comment). Mirrors brands/product_brands,
-- minus the fields brands need that this doesn't (logo, country).

create table public.vehicle_types (
  slug text primary key,
  name text not null,
  "order" integer not null default 0
);

alter table public.vehicle_types enable row level security;
create policy "Public can read vehicle_types" on public.vehicle_types for select using (true);

create table public.product_vehicle_types (
  product_id uuid not null references public.products(id) on delete cascade,
  vehicle_type_slug text not null references public.vehicle_types(slug) on delete cascade,
  primary key (product_id, vehicle_type_slug)
);

alter table public.product_vehicle_types enable row level security;
create policy "Public can read vehicle types of published products" on public.product_vehicle_types for select using (
  exists (select 1 from public.products p where p.id = product_id and p.published = true)
);

create index product_vehicle_types_slug_idx on public.product_vehicle_types (vehicle_type_slug);
