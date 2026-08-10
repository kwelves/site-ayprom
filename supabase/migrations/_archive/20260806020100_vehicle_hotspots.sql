-- Presentation + product-linking data for the homepage "Спецтехника" hotspot
-- section. Each vehicle type has up to 5 numbered hotspots positioned as a
-- percentage of its showcase photo (coordinates sourced from the approved
-- Figma reference, not derived in code — see project memory). product_id is
-- nullable because most hotspots don't have a matching catalog product yet;
-- those render as a "coming soon" placeholder card instead of being hidden.
-- Admin editing of label/product_id is a deferred follow-up — this table
-- shape is designed so that UI can be added later without a schema change.
create table public.vehicle_hotspots (
  id uuid primary key default gen_random_uuid(),
  vehicle_type_slug text not null references public.vehicle_types(slug) on delete cascade,
  hotspot_number smallint not null check (hotspot_number between 1 and 5),
  label text not null,
  x_pct numeric(5, 2) not null,
  y_pct numeric(5, 2) not null,
  product_id uuid references public.products(id) on delete set null,
  unique (vehicle_type_slug, hotspot_number)
);

alter table public.vehicle_hotspots enable row level security;
create policy "Public can read vehicle_hotspots" on public.vehicle_hotspots for select using (true);

create index vehicle_hotspots_vehicle_type_slug_idx on public.vehicle_hotspots (vehicle_type_slug);

insert into public.vehicle_hotspots (vehicle_type_slug, hotspot_number, label, x_pct, y_pct, product_id) values
  ('kran-manipulyator', 1, 'Гидробак', 75.37, 65.43, null),
  ('kran-manipulyator', 2, 'Гидронасос', 64.13, 68.55, null),
  ('kran-manipulyator', 3, 'КОМ', 54.75, 71.94, (select id from public.products where slug = 'korobka-otbora-moschnosti-zf-1')),
  ('kran-manipulyator', 4, 'Гидрораспределитель', 57.04, 50.07, null),
  ('kran-manipulyator', 5, 'Кнопка пневмоуправления', 29.14, 46.81, null),

  ('musorovoz', 1, 'Кнопка пневмоуправления', 20.75, 39.63, null),
  ('musorovoz', 2, 'Гидрораспределитель', 94.39, 51.97, null),
  ('musorovoz', 3, 'КОМ', 59.52, 78.39, null),
  ('musorovoz', 4, 'Гидронасос', 56.40, 62.80, null),
  ('musorovoz', 5, 'Гидробак', 72.12, 61.44, null),

  ('avtovoz', 1, 'Гидрораспределитель', 78.50, 72.18, null),
  ('avtovoz', 2, 'Гидробак', 56.58, 68.83, null),
  ('avtovoz', 3, 'КОМ', 44.98, 68.69, null),
  ('avtovoz', 4, 'Гидронасос', 49.68, 61.58, null),
  ('avtovoz', 5, 'Кнопка пневмоуправления', 27.76, 51.11, null),

  ('samosval', 1, 'Гидронасос', 58.61, 75.83, (select id from public.products where slug = 'ay-gp110')),
  ('samosval', 2, 'КОМ', 66.90, 64.62, (select id from public.products where slug = 'korobka-otbora-moschnosti-zf-1')),
  ('samosval', 3, 'Джойстик подъёма/опускания', 44.43, 34.69, null),
  ('samosval', 4, 'Распределитель', 64.60, 25.32, null),
  ('samosval', 5, 'Гидробак за кабиной', 65.88, 42.45, (select id from public.products where slug = 'stalnoy-zakabinnyy-bak-gemma-60-lt-310-410-510')),

  ('tyagach', 1, 'Распределитель', 52.63, 79.03, null),
  ('tyagach', 2, 'Джойстик подъёма/опускания', 36.33, 75.57, null),
  ('tyagach', 3, 'Гидронасос', 45.81, 91.86, null),
  ('tyagach', 4, 'КОМ', 44.71, 82.58, (select id from public.products where slug = 'korobka-otbora-moschnosti-zf-1')),
  ('tyagach', 5, 'Гидробак', 55.02, 87.22, (select id from public.products where slug = 'stalnoy-zakabinnyy-bak-gemma-60-lt-310-410-510'));
