-- One-time migration of the current mock data (src/data/*.ts) into the real
-- schema, so the admin panel and frontend have something real to work
-- against. This mirrors exactly what's in the TS files at the time of
-- writing — including the deliberately-incomplete test products.

insert into public.categories (slug, name, description, icon, image, intro, type, "order") values
  ('hydraulic-pumps', 'Гидронасосы', 'Создают давление для навесного гидрооборудования спецтехники', 'hydraulic-pump', '/catalog-cards/1-gydro-pupms.jpg', null, 'subcategory', 0),
  ('pto', 'Коробки отбора мощности', 'КОМ для навесного и гидравлического оборудования спецтехники', 'pto', '/catalog-cards/2-pto.jpg', 'Коробка отбора мощности (КОМ) передаёт крутящий момент от коробки передач тягача на гидравлический насос навесного оборудования. Модель КОМ подбирается под конкретную коробку передач и марку техники — при подборе важно точно знать модель вашей КПП.', 'brand', 1),
  ('pto-shafts', 'Валы отбора мощности', 'Карданные валы для передачи мощности от КОМ к насосу', 'pto-shaft', '/catalog-cards/3-valves.jpg', 'Вал отбора мощности передаёт крутящий момент от КОМ к гидравлическому насосу. Подбирается по марке техники и посадочным размерам — важно, чтобы вал точно подходил к уже установленной коробке отбора мощности.', 'brand', 2),
  ('tanks', 'Гидравлические баки', 'Резервуар для рабочей жидкости гидросистемы — сбоку рамы или за кабиной', 'tank', '/catalog-cards/hydro-tanks.jpg', null, 'subcategory', 3);

insert into public.subcategories (category_slug, slug, name, image, intro, "order") values
  ('hydraulic-pumps', 'gear-pumps', 'Шестерённые насосы', '/category-hydraulic-pumps/1-gear-pumps.jpg', 'Шестерённый насос — самый распространённый тип гидронасоса для навесного оборудования спецтехники. Жидкость перемещается за счёт вращения двух сцепленных шестерён — конструкция простая, недорогая и устойчивая к постоянным нагрузкам, поэтому хорошо подходит для большинства самосвалов и другой техники со средним рабочим давлением.', 0),
  ('hydraulic-pumps', 'axial-piston-pumps', 'Аксиально поршневые насосы', '/category-hydraulic-pumps/2-axial-piston-pumps.jpg', 'Аксиально-поршневой насос устроен сложнее шестерённого, но выдерживает более высокое рабочее давление и обеспечивает точную, регулируемую подачу жидкости. Поршни расположены параллельно оси вращения блока цилиндров — такая конструкция хорошо переносит интенсивные и переменные нагрузки.', 1),
  ('hydraulic-pumps', 'inline-piston-pumps', 'Прямые поршневые насосы', '/category-hydraulic-pumps/3-inline-piston-pumps.jpg', 'Прямой поршневой насос, как и аксиально-поршневой, выдерживает высокое давление, но за счёт другого расположения поршней — компактнее при сопоставимой мощности. Применяется там, где важны надёжность и долгий срок службы при интенсивной работе.', 2),
  ('tanks', 'side-tanks', 'Боковые', '/categoty-hydro-tanks/1-side-tanks.jpg', 'Боковой гидравлический бак крепится сбоку рамы тягача или прицепа и не занимает место за кабиной. Такое расположение удобно для техники, где пространство за кабиной уже занято другим оборудованием.', 0),
  ('tanks', 'behind-cab-tanks', 'За кабину', '/categoty-hydro-tanks/2-behind-cab-tanks.jpg', 'Гидравлический бак за кабиной устанавливается в пространстве между кабиной и рамой. Это стандартное решение для большинства тягачей и самосвалов, где сбоку рамы недостаточно свободного места.', 1);

insert into public.brands (slug, name, country, logo, logo_scale, relation, "order") values
  ('daf', 'DAF', 'Нидерланды', '/brands-icons-svg/daf-logo.svg', 1.15, 'for', 0),
  ('man', 'MAN', 'Германия', '/brands-icons-svg/MAN-Logo.svg', null, 'for', 1),
  ('scania', 'Scania', 'Швеция', '/brands-icons-svg/scania-logo.svg', null, 'for', 2),
  ('maz', 'MAZ', 'Беларусь', '/brands-icons-svg/maz-logo.svg', null, 'for', 3),
  ('kamaz', 'KAMAZ', 'Россия', '/brands-icons-svg/kamaz-logo.svg', null, 'for', 4),
  ('renault-trucks', 'Renault Trucks', 'Франция', '/brands-icons-svg/renault-trucks.svg', 1.6, 'for', 5),
  ('mercedes-benz', 'Mercedes-Benz', 'Германия', '/brands-icons-svg/mercedes-benz-logo.svg', 1.3, 'for', 6),
  ('volvo', 'Volvo', 'Швеция', '/brands-icons-svg/volvo-logo.svg', null, 'for', 7),
  ('zf', 'ZF', 'Германия', '/brands-icons-svg/zf-logo.svg', null, 'from', 8),
  ('sitrak', 'Sitrak', 'Китай', '/brands-icons-svg/sitrak-logo.svg', null, 'for', 9),
  ('shacman', 'Shacman', 'Китай', '/brands-icons-svg/shacman-logo.svg', 1.4, 'for', 10),
  ('faw', 'FAW', 'Китай', '/brands-icons-svg/FAW-logo.svg', null, 'for', 11),
  ('howo', 'HOWO', 'Китай', '/brands-icons-svg/howo-logo.svg', null, 'for', 12),
  ('isuzu', 'Isuzu', 'Япония', '/brands-icons-svg/isuzu-logo.svg', 0.75, 'for', 13),
  ('foton', 'Foton', 'Китай', '/brands-icons-svg/foton.svg', 1.6, 'for', 14);

-- pto and pto-shafts share the same 9 brands (comAndShaftBrandSlugs)
insert into public.category_brands (category_slug, brand_slug, logo_scale_override, "order")
select c.slug, b.brand_slug, b.scale_override, b.ord
from (values ('pto'), ('pto-shafts')) as c(slug)
cross join (values
  ('daf', 1.15, 0),
  ('man', 0.95, 1),
  ('scania', 0.95, 2),
  ('maz', 0.95, 3),
  ('kamaz', 1.15, 4),
  ('renault-trucks', 1.3, 5),
  ('mercedes-benz', 1.15, 6),
  ('volvo', 1.15, 7),
  ('zf', null, 8)
) as b(brand_slug, scale_override, ord);

-- 12 deliberately-incomplete test products (all gear-pumps) — matches
-- src/data/products.ts's generator at the time of writing.
insert into public.products (slug, name, category_slug, subcategory_id, short_description, "order")
select p.slug, p.name, 'hydraulic-pumps',
  (select id from public.subcategories where category_slug = 'hydraulic-pumps' and slug = 'gear-pumps'),
  'Шестерённый гидравлический насос для навесного оборудования спецтехники.',
  p.ord
from (values
  ('ay-gp110', 'Шестерённый насос AY-GP110', 0),
  ('ay-gp111', 'Шестерённый насос AY-GP111', 1),
  ('ay-gp112', 'Шестерённый насос AY-GP112', 2),
  ('ay-gp113', 'Шестерённый насос AY-GP113', 3),
  ('ay-gp114', 'Шестерённый насос AY-GP114', 4),
  ('ay-gp115', 'Шестерённый насос AY-GP115', 5),
  ('ay-gp116', 'Шестерённый насос AY-GP116', 6),
  ('ay-gp117', 'Шестерённый насос AY-GP117', 7),
  ('ay-gp118', 'Шестерённый насос AY-GP118', 8),
  ('ay-gp119', 'Шестерённый насос AY-GP119', 9),
  ('ay-gp120', 'Шестерённый насос AY-GP120', 10),
  ('ay-gp121', 'Шестерённый насос AY-GP121', 11)
) as p(slug, name, ord);

-- Same placeholder photo x5 per product, matching Array(5).fill(...) in the mock data.
insert into public.product_images (product_id, url, "order")
select pr.id, '/category-hydraulic-pumps/1-gear-pumps.jpg', img.ord
from public.products pr
cross join (values (0),(1),(2),(3),(4)) as img(ord)
where pr.slug like 'ay-gp%';

insert into public.product_brands (product_id, brand_slug)
select pr.id, pb.brand_slug
from public.products pr
join (values
  ('ay-gp110', 'daf'), ('ay-gp110', 'man'),
  ('ay-gp111', 'kamaz'),
  ('ay-gp112', 'volvo'), ('ay-gp112', 'howo'),
  ('ay-gp113', 'man'),
  ('ay-gp114', 'isuzu'), ('ay-gp114', 'daf'),
  ('ay-gp115', 'scania'),
  ('ay-gp116', 'howo'), ('ay-gp116', 'zf'),
  ('ay-gp117', 'mercedes-benz'),
  ('ay-gp118', 'shacman'), ('ay-gp118', 'volvo'),
  ('ay-gp119', 'zf'),
  ('ay-gp120', 'foton'), ('ay-gp120', 'kamaz'),
  ('ay-gp121', 'renault-trucks')
) as pb(slug, brand_slug) on pb.slug = pr.slug;
