-- AYPROM initial schema: categories, subcategories, brands, products, and
-- their join/child tables, with row level security enabled everywhere.
-- Public (anon/publishable key) gets read-only access; writes only happen
-- through the admin backend using the service_role key, which bypasses RLS.

create table public.categories (
  slug text primary key,
  name text not null,
  description text not null,
  icon text not null,
  image text not null,
  intro text,
  type text not null check (type in ('subcategory', 'brand')),
  "order" integer not null default 0
);

alter table public.categories enable row level security;
create policy "Public can read categories" on public.categories for select using (true);

create table public.subcategories (
  id uuid primary key default gen_random_uuid(),
  category_slug text not null references public.categories(slug) on delete cascade,
  slug text not null,
  name text not null,
  image text not null,
  intro text,
  "order" integer not null default 0,
  unique (category_slug, slug)
);

alter table public.subcategories enable row level security;
create policy "Public can read subcategories" on public.subcategories for select using (true);

create table public.brands (
  slug text primary key,
  name text not null,
  country text not null,
  logo text not null,
  logo_scale numeric,
  relation text not null check (relation in ('for', 'from')),
  "order" integer not null default 0
);

alter table public.brands enable row level security;
create policy "Public can read brands" on public.brands for select using (true);

-- Which brands appear under a brand-type category (pto, pto-shafts), and
-- with what logo scale override — replaces the old brandsByCategory /
-- categoryCardLogoScale mock-data tables.
create table public.category_brands (
  category_slug text not null references public.categories(slug) on delete cascade,
  brand_slug text not null references public.brands(slug) on delete cascade,
  logo_scale_override numeric,
  "order" integer not null default 0,
  primary key (category_slug, brand_slug)
);

alter table public.category_brands enable row level security;
create policy "Public can read category_brands" on public.category_brands for select using (true);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category_slug text not null references public.categories(slug),
  subcategory_id uuid references public.subcategories(id),
  short_description text not null,
  description text,
  article text,
  published boolean not null default true,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;
create policy "Public can read published products" on public.products for select using (published = true);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  "order" integer not null default 0
);

alter table public.product_images enable row level security;
create policy "Public can read images of published products" on public.product_images for select using (
  exists (select 1 from public.products p where p.id = product_id and p.published = true)
);

create table public.product_characteristics (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  attribute text not null,
  value text not null,
  "order" integer not null default 0
);

alter table public.product_characteristics enable row level security;
create policy "Public can read characteristics of published products" on public.product_characteristics for select using (
  exists (select 1 from public.products p where p.id = product_id and p.published = true)
);

-- Replaces the old compatibleBrands: string[] on the mock Product type.
create table public.product_brands (
  product_id uuid not null references public.products(id) on delete cascade,
  brand_slug text not null references public.brands(slug) on delete cascade,
  primary key (product_id, brand_slug)
);

alter table public.product_brands enable row level security;
create policy "Public can read brands of published products" on public.product_brands for select using (
  exists (select 1 from public.products p where p.id = product_id and p.published = true)
);

create index products_category_slug_idx on public.products (category_slug);
create index products_subcategory_id_idx on public.products (subcategory_id);
create index product_images_product_id_idx on public.product_images (product_id);
create index product_characteristics_product_id_idx on public.product_characteristics (product_id);
create index product_brands_brand_slug_idx on public.product_brands (brand_slug);
