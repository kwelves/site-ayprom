-- Данные для локальной разработки. Применяются только при `supabase db reset`
-- и никогда не попадают на удалённый проект: `db push` сиды не выполняет.
--
-- Раньше этот набор жил в миграции 0004_seed_mock_data вместе со схемой.
-- Разделение сделано осознанно: миграции описывают структуру, сиды наполняют
-- локальную базу. Снято с локальной базы, которая совпадает с продом.
SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict TL5kTih7ITj8aT8ZAloxTIH3rns3Ih7VrFP0uft0Brd3ZqWiDo2UGuCxszrh3b7

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: admin_audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."admin_audit_log" ("id", "occurred_at", "actor", "action", "entity_type", "entity_key", "changed_fields") OVERRIDING SYSTEM VALUE VALUES
	(1, '2026-08-08 21:36:34.649806+00', 'postgres', 'INSERT', 'vehicle_types', 'musorovoz', '{created}'),
	(6, '2026-08-10 09:43:47.179576+00', 'postgres', 'UPDATE', 'products', 'ay-gp110', '{search_text}');


--
-- Data for Name: admin_login_rate_limits; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."admin_login_rate_limits" ("key_hash", "failed_count", "window_started_at", "last_attempt_at", "blocked_until") VALUES
	('probe-key', 5, '2026-08-08 21:38:03.338366+00', '2026-08-08 21:38:03.339317+00', '2026-08-08 21:53:03.339317+00');


--
-- Data for Name: brands; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."brands" ("slug", "name", "country", "logo", "logo_scale", "order", "aliases") VALUES
	('daf', 'DAF', 'Нидерланды', '/brands-icons-svg/daf-logo.svg', 1.15, 0, '{даф}'),
	('man', 'MAN', 'Германия', '/brands-icons-svg/MAN-Logo.svg', NULL, 1, '{ман}'),
	('scania', 'Scania', 'Швеция', '/brands-icons-svg/scania-logo.svg', NULL, 2, '{скания}'),
	('maz', 'MAZ', 'Беларусь', '/brands-icons-svg/maz-logo.svg', NULL, 3, '{маз}'),
	('kamaz', 'KAMAZ', 'Россия', '/brands-icons-svg/kamaz-logo.svg', NULL, 4, '{камаз}'),
	('renault-trucks', 'Renault Trucks', 'Франция', '/brands-icons-svg/renault-trucks.svg', 1.6, 5, '{рено,"рено тракс"}'),
	('mercedes-benz', 'Mercedes-Benz', 'Германия', '/brands-icons-svg/mercedes-benz-logo.svg', 1.3, 6, '{мерседес,мерс}'),
	('volvo', 'Volvo', 'Швеция', '/brands-icons-svg/volvo-logo.svg', NULL, 7, '{вольво}'),
	('zf', 'ZF', 'Германия', '/brands-icons-svg/zf-logo.svg', NULL, 8, '{зф}'),
	('sitrak', 'Sitrak', 'Китай', '/brands-icons-svg/sitrak-logo.svg', NULL, 9, '{ситрак}'),
	('shacman', 'Shacman', 'Китай', '/brands-icons-svg/shacman-logo.svg', 1.4, 10, '{шакман,шаанси}'),
	('faw', 'FAW', 'Китай', '/brands-icons-svg/FAW-logo.svg', NULL, 11, '{фав}'),
	('howo', 'HOWO', 'Китай', '/brands-icons-svg/howo-logo.svg', NULL, 12, '{хово}'),
	('isuzu', 'Isuzu', 'Япония', '/brands-icons-svg/isuzu-logo.svg', 0.75, 13, '{исузу}'),
	('foton', 'Foton', 'Китай', '/brands-icons-svg/foton.svg', 1.6, 14, '{фотон}');


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."categories" ("slug", "name", "description", "icon", "image", "intro", "type", "order") VALUES
	('hydraulic-pumps', 'Гидронасосы', 'Создают давление для навесного гидрооборудования спецтехники', 'hydraulic-pump', '/catalog-cards/1-gydro-pupms.jpg', NULL, 'subcategory', 0),
	('pto', 'Коробки отбора мощности', 'КОМ для навесного и гидравлического оборудования спецтехники', 'pto', '/catalog-cards/2-pto.jpg', 'Коробка отбора мощности (КОМ) передаёт крутящий момент от коробки передач тягача на гидравлический насос навесного оборудования. Модель КОМ подбирается под конкретную коробку передач и марку техники — при подборе важно точно знать модель вашей КПП.', 'brand', 1),
	('pto-shafts', 'Валы отбора мощности', 'Карданные валы для передачи мощности от КОМ к насосу', 'pto-shaft', '/catalog-cards/3-valves.jpg', 'Вал отбора мощности передаёт крутящий момент от КОМ к гидравлическому насосу. Подбирается по марке техники и посадочным размерам — важно, чтобы вал точно подходил к уже установленной коробке отбора мощности.', 'brand', 2),
	('tanks', 'Гидравлические баки', 'Резервуар для рабочей жидкости гидросистемы — сбоку рамы или за кабиной', 'tank', '/catalog-cards/hydro-tanks.jpg', NULL, 'subcategory', 3);


--
-- Data for Name: category_brands; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."category_brands" ("category_slug", "brand_slug", "logo_scale_override", "order") VALUES
	('pto', 'daf', 1.15, 0),
	('pto-shafts', 'daf', 1.15, 0),
	('pto', 'man', 0.95, 1),
	('pto-shafts', 'man', 0.95, 1),
	('pto', 'scania', 0.95, 2),
	('pto-shafts', 'scania', 0.95, 2),
	('pto', 'maz', 0.95, 3),
	('pto-shafts', 'maz', 0.95, 3),
	('pto', 'kamaz', 1.15, 4),
	('pto-shafts', 'kamaz', 1.15, 4),
	('pto', 'renault-trucks', 1.3, 5),
	('pto-shafts', 'renault-trucks', 1.3, 5),
	('pto', 'mercedes-benz', 1.15, 6),
	('pto-shafts', 'mercedes-benz', 1.15, 6),
	('pto', 'volvo', 1.15, 7),
	('pto-shafts', 'volvo', 1.15, 7),
	('pto', 'zf', NULL, 8),
	('pto-shafts', 'zf', NULL, 8);


--
-- Data for Name: subcategories; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."subcategories" ("id", "category_slug", "slug", "name", "image", "intro", "order") VALUES
	('2b113d76-ba1d-4057-870c-55bce2c5ff16', 'hydraulic-pumps', 'gear-pumps', 'Шестерённые насосы', '/category-hydraulic-pumps/1-gear-pumps.jpg', 'Шестерённый насос — самый распространённый тип гидронасоса для навесного оборудования спецтехники. Жидкость перемещается за счёт вращения двух сцепленных шестерён — конструкция простая, недорогая и устойчивая к постоянным нагрузкам, поэтому хорошо подходит для большинства самосвалов и другой техники со средним рабочим давлением.', 0),
	('66cf3683-da3e-49b3-bdab-770fd31156e4', 'hydraulic-pumps', 'axial-piston-pumps', 'Аксиально поршневые насосы', '/category-hydraulic-pumps/2-axial-piston-pumps.jpg', 'Аксиально-поршневой насос устроен сложнее шестерённого, но выдерживает более высокое рабочее давление и обеспечивает точную, регулируемую подачу жидкости. Поршни расположены параллельно оси вращения блока цилиндров — такая конструкция хорошо переносит интенсивные и переменные нагрузки.', 1),
	('fb4dd6bc-0f0b-496a-bf1a-0113450652ae', 'hydraulic-pumps', 'inline-piston-pumps', 'Прямые поршневые насосы', '/category-hydraulic-pumps/3-inline-piston-pumps.jpg', 'Прямой поршневой насос, как и аксиально-поршневой, выдерживает высокое давление, но за счёт другого расположения поршней — компактнее при сопоставимой мощности. Применяется там, где важны надёжность и долгий срок службы при интенсивной работе.', 2),
	('81659eed-a317-4fba-be19-4f003b4dc1f6', 'tanks', 'side-tanks', 'Боковые', '/categoty-hydro-tanks/1-side-tanks.jpg', 'Боковой гидравлический бак крепится сбоку рамы тягача или прицепа и не занимает место за кабиной. Такое расположение удобно для техники, где пространство за кабиной уже занято другим оборудованием.', 0),
	('c9f71ae0-5357-4dd8-8716-14cdb1d7ed60', 'tanks', 'behind-cab-tanks', 'За кабину', '/categoty-hydro-tanks/2-behind-cab-tanks.jpg', 'Гидравлический бак за кабиной устанавливается в пространстве между кабиной и рамой. Это стандартное решение для большинства тягачей и самосвалов, где сбоку рамы недостаточно свободного места.', 1);


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."products" ("id", "slug", "name", "category_slug", "subcategory_id", "short_description", "description", "article", "published", "order", "created_at", "updated_at", "search_text") VALUES
	('bc69dece-3184-4018-98f7-247d9b3837e9', 'ay-gp111', 'Шестерённый насос AY-GP111', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 1, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp111 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы kamaz камаз'),
	('dc5659a3-3634-453c-a10b-6630539bfbdb', 'ay-gp112', 'Шестерённый насос AY-GP112', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 2, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp112 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы volvo вольво howo хово'),
	('dfda7f43-eebc-46f5-9717-b38d9d985c90', 'ay-gp113', 'Шестерённый насос AY-GP113', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 3, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp113 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы man ман'),
	('5976b6fe-d60b-4cce-be1f-b8095f20ce92', 'ay-gp114', 'Шестерённый насос AY-GP114', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 4, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp114 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы daf даф isuzu исузу'),
	('4f80cf77-e04e-4ff1-b618-b3d200409b6e', 'ay-gp115', 'Шестерённый насос AY-GP115', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 5, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp115 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы scania скания'),
	('e47d4f9e-4db2-4dc4-aa46-81521bcf4e0b', 'ay-gp116', 'Шестерённый насос AY-GP116', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 6, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp116 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы zf зф howo хово'),
	('370e2a19-fb34-4f1d-8f7c-cd9c243e0930', 'ay-gp117', 'Шестерённый насос AY-GP117', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 7, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp117 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы mercedes benz мерседес мерс'),
	('cc878339-7506-4daa-8a4e-0c3add97da14', 'ay-gp110', 'Шестерённый насос AY-GP110', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 0, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp110 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы man ман daf даф'),
	('a72d43ed-7e0d-48d7-8b61-ce32063db3db', 'ay-gp118', 'Шестерённый насос AY-GP118', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 8, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp118 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы volvo вольво shacman шакман шаанси'),
	('3eb62c66-6067-4d49-a664-d9a9792449a4', 'ay-gp119', 'Шестерённый насос AY-GP119', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 9, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp119 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы zf зф'),
	('d3032fed-5944-4439-9c1e-d5538de2ece3', 'ay-gp120', 'Шестерённый насос AY-GP120', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 10, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp120 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы kamaz камаз foton фотон'),
	('ee4092c0-5165-4bc4-8f79-50b61a64f946', 'ay-gp121', 'Шестерённый насос AY-GP121', 'hydraulic-pumps', '2b113d76-ba1d-4057-870c-55bce2c5ff16', 'Шестерённый гидравлический насос для навесного оборудования спецтехники.', NULL, NULL, true, 11, '2026-08-08 21:36:34.04751+00', '2026-08-08 21:36:34.04751+00', 'шестерённый насос ay gp121 шестерённый гидравлический насос для навесного оборудования спецтехники гидронасосы шестерённые насосы renault trucks рено рено тракс');


--
-- Data for Name: product_brands; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."product_brands" ("product_id", "brand_slug") VALUES
	('cc878339-7506-4daa-8a4e-0c3add97da14', 'man'),
	('cc878339-7506-4daa-8a4e-0c3add97da14', 'daf'),
	('bc69dece-3184-4018-98f7-247d9b3837e9', 'kamaz'),
	('dc5659a3-3634-453c-a10b-6630539bfbdb', 'howo'),
	('dc5659a3-3634-453c-a10b-6630539bfbdb', 'volvo'),
	('dfda7f43-eebc-46f5-9717-b38d9d985c90', 'man'),
	('5976b6fe-d60b-4cce-be1f-b8095f20ce92', 'daf'),
	('5976b6fe-d60b-4cce-be1f-b8095f20ce92', 'isuzu'),
	('4f80cf77-e04e-4ff1-b618-b3d200409b6e', 'scania'),
	('e47d4f9e-4db2-4dc4-aa46-81521bcf4e0b', 'zf'),
	('e47d4f9e-4db2-4dc4-aa46-81521bcf4e0b', 'howo'),
	('370e2a19-fb34-4f1d-8f7c-cd9c243e0930', 'mercedes-benz'),
	('a72d43ed-7e0d-48d7-8b61-ce32063db3db', 'volvo'),
	('a72d43ed-7e0d-48d7-8b61-ce32063db3db', 'shacman'),
	('3eb62c66-6067-4d49-a664-d9a9792449a4', 'zf'),
	('d3032fed-5944-4439-9c1e-d5538de2ece3', 'kamaz'),
	('d3032fed-5944-4439-9c1e-d5538de2ece3', 'foton'),
	('ee4092c0-5165-4bc4-8f79-50b61a64f946', 'renault-trucks');


--
-- Data for Name: product_characteristics; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: product_images; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."product_images" ("id", "product_id", "url", "order", "scale") VALUES
	('995b9ba8-9ede-4384-973b-dedccc3e0c04', 'cc878339-7506-4daa-8a4e-0c3add97da14', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('fb4869e6-4d44-4aee-af22-fca74542ae6e', 'cc878339-7506-4daa-8a4e-0c3add97da14', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('2c44648f-b1c3-4f5b-b35b-eeaa21138ec3', 'cc878339-7506-4daa-8a4e-0c3add97da14', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('1b9d3676-c797-4801-b894-43679fda0581', 'cc878339-7506-4daa-8a4e-0c3add97da14', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('bd9d07a9-414a-4a13-a607-637b536cfbb1', 'cc878339-7506-4daa-8a4e-0c3add97da14', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('0b3f5c1e-4756-4629-a72f-50a723258970', 'bc69dece-3184-4018-98f7-247d9b3837e9', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('ed5ad780-b963-4211-917c-7af98b047e17', 'bc69dece-3184-4018-98f7-247d9b3837e9', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('566ba720-73f3-4b97-bed3-b0dbd78218bb', 'bc69dece-3184-4018-98f7-247d9b3837e9', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('d7b5e5bd-9469-42dd-ba68-ff80e25dc385', 'bc69dece-3184-4018-98f7-247d9b3837e9', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('f15af1fa-1378-44d8-83b7-1f6dc33086ec', 'bc69dece-3184-4018-98f7-247d9b3837e9', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('9a84f4a0-100c-4be9-bb74-7580d3e80845', 'dc5659a3-3634-453c-a10b-6630539bfbdb', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('7b560ddd-da71-4411-9cde-2eefe80e9a9a', 'dc5659a3-3634-453c-a10b-6630539bfbdb', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('157764fa-be49-4913-95a6-b9d090219e59', 'dc5659a3-3634-453c-a10b-6630539bfbdb', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('c0c7fd61-26e2-4232-a272-1f0f92d69512', 'dc5659a3-3634-453c-a10b-6630539bfbdb', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('10c471f4-2c42-43a4-a28a-b6fec160c068', 'dc5659a3-3634-453c-a10b-6630539bfbdb', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('a252cfea-fc21-42a5-b6f3-153953058e5c', 'dfda7f43-eebc-46f5-9717-b38d9d985c90', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('3133ec2c-05ed-4d4b-aa05-c80605950e6d', 'dfda7f43-eebc-46f5-9717-b38d9d985c90', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('96975e09-2714-4798-9b54-9e0216ff6091', 'dfda7f43-eebc-46f5-9717-b38d9d985c90', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('02342f6d-6087-47ca-9e96-96e8e41e768e', 'dfda7f43-eebc-46f5-9717-b38d9d985c90', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('a9242295-fcca-456b-b60e-815cdd48eecc', 'dfda7f43-eebc-46f5-9717-b38d9d985c90', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('c79dfa1d-e96a-4ea1-9257-bbcc05062fea', '5976b6fe-d60b-4cce-be1f-b8095f20ce92', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('20e77df0-341a-43e7-a749-3d8242cf634d', '5976b6fe-d60b-4cce-be1f-b8095f20ce92', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('fb98533b-1692-4787-9924-7f064f1eebc5', '5976b6fe-d60b-4cce-be1f-b8095f20ce92', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('744ca22e-83f0-4ea3-809d-f6e3ed75c82a', '5976b6fe-d60b-4cce-be1f-b8095f20ce92', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('9b4dea12-341f-4ba4-bac5-8977320c4ab4', '5976b6fe-d60b-4cce-be1f-b8095f20ce92', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('7ea4b1af-2b3c-4099-9b0c-a1eb0eaff2f6', '4f80cf77-e04e-4ff1-b618-b3d200409b6e', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('b75ff119-ee5b-44af-adae-47acceb8c015', '4f80cf77-e04e-4ff1-b618-b3d200409b6e', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('9edc6177-0b06-437d-acb6-8cf8a77d6c0e', '4f80cf77-e04e-4ff1-b618-b3d200409b6e', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('76471207-f648-49bf-bbbe-6ff387783c32', '4f80cf77-e04e-4ff1-b618-b3d200409b6e', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('502b07ce-838d-4f70-b083-ffba8d6c15e9', '4f80cf77-e04e-4ff1-b618-b3d200409b6e', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('0db1b90e-8bca-4a95-9a10-4cd97b09a7e1', 'e47d4f9e-4db2-4dc4-aa46-81521bcf4e0b', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('0b9c1306-f8d7-4dfe-ba50-ad73ba5fc1eb', 'e47d4f9e-4db2-4dc4-aa46-81521bcf4e0b', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('e6ad4b4b-0185-4edd-a859-51f9fc48ae01', 'e47d4f9e-4db2-4dc4-aa46-81521bcf4e0b', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('5348c8ce-9c9b-4225-b6b2-aa031e718d49', 'e47d4f9e-4db2-4dc4-aa46-81521bcf4e0b', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('6993be0e-be3f-44bb-bedc-03fa73d1f2cc', 'e47d4f9e-4db2-4dc4-aa46-81521bcf4e0b', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('d3b3e706-4d58-4d72-bb5f-ff21bbb449ba', '370e2a19-fb34-4f1d-8f7c-cd9c243e0930', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('6afa6411-b82f-4835-89d3-9190f9507fec', '370e2a19-fb34-4f1d-8f7c-cd9c243e0930', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('31369364-d5a1-4ecd-8e03-ab892d58627e', '370e2a19-fb34-4f1d-8f7c-cd9c243e0930', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('4279d4fc-6a10-42ab-a090-208871147983', '370e2a19-fb34-4f1d-8f7c-cd9c243e0930', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('5cbe39c5-20c9-424c-81cc-7837da46126b', '370e2a19-fb34-4f1d-8f7c-cd9c243e0930', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('9d5f6ea8-4387-45c4-a3ab-f45c81d94c13', 'a72d43ed-7e0d-48d7-8b61-ce32063db3db', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('95cd6804-bd72-4c07-b27f-b857f74bcdef', 'a72d43ed-7e0d-48d7-8b61-ce32063db3db', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('10e0b9b1-432e-444b-aa93-999b121478ae', 'a72d43ed-7e0d-48d7-8b61-ce32063db3db', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('dd1bbfea-bcb6-47e6-a0bb-c6391c294778', 'a72d43ed-7e0d-48d7-8b61-ce32063db3db', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('fec977f1-3b72-4cc3-8be8-c62a0b550819', 'a72d43ed-7e0d-48d7-8b61-ce32063db3db', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('1f390a21-a678-4512-91fa-d1bc238faf33', '3eb62c66-6067-4d49-a664-d9a9792449a4', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('e9026881-518a-4b2c-add4-f5009615f4b7', '3eb62c66-6067-4d49-a664-d9a9792449a4', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('9fd2c70e-cef1-4d64-a324-4528234a1549', '3eb62c66-6067-4d49-a664-d9a9792449a4', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('2dfb8324-af96-4209-beab-36266e84ba92', '3eb62c66-6067-4d49-a664-d9a9792449a4', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('9852178a-5ecf-47a1-a48c-f0b1e04c2d1f', '3eb62c66-6067-4d49-a664-d9a9792449a4', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('86321d7a-53e1-42e0-87c9-4421ac58795c', 'd3032fed-5944-4439-9c1e-d5538de2ece3', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('0628e00d-90be-4ac2-bcb9-d7001070f8dd', 'd3032fed-5944-4439-9c1e-d5538de2ece3', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('00b28128-b85c-44db-bbe8-69a6c054ee9d', 'd3032fed-5944-4439-9c1e-d5538de2ece3', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('2cb114c5-3b91-4909-b974-83e6dcb4ade6', 'd3032fed-5944-4439-9c1e-d5538de2ece3', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('019e59f0-aeb2-40dc-9e86-ecfc23a8941f', 'd3032fed-5944-4439-9c1e-d5538de2ece3', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL),
	('fa64d799-4bed-4398-9401-36a358c98c4a', 'ee4092c0-5165-4bc4-8f79-50b61a64f946', '/category-hydraulic-pumps/1-gear-pumps.jpg', 0, NULL),
	('96b9626a-be3f-4ca7-b67b-5f73513da800', 'ee4092c0-5165-4bc4-8f79-50b61a64f946', '/category-hydraulic-pumps/1-gear-pumps.jpg', 1, NULL),
	('ce0edc72-c110-4e68-a7cb-4d4d68893ad3', 'ee4092c0-5165-4bc4-8f79-50b61a64f946', '/category-hydraulic-pumps/1-gear-pumps.jpg', 2, NULL),
	('2f95d1bb-ed88-4986-b989-abd838662241', 'ee4092c0-5165-4bc4-8f79-50b61a64f946', '/category-hydraulic-pumps/1-gear-pumps.jpg', 3, NULL),
	('b188593a-4ad6-4e2d-8b68-401959d5a2d6', 'ee4092c0-5165-4bc4-8f79-50b61a64f946', '/category-hydraulic-pumps/1-gear-pumps.jpg', 4, NULL);


--
-- Data for Name: vehicle_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."vehicle_types" ("slug", "name", "order") VALUES
	('samosval', 'Самосвал', 0),
	('kran-manipulyator', 'Кран-Манипулятор', 1),
	('tyagach', 'Тонар', 2),
	('avtovoz', 'Автовоз', 3),
	('musorovoz', 'Мусоровоз', 4);


--
-- Data for Name: product_vehicle_types; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: vehicle_hotspots; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."vehicle_hotspots" ("id", "vehicle_type_slug", "hotspot_number", "label", "x_pct", "y_pct", "product_id") VALUES
	('fd4c9141-ccdc-4035-97db-4e8cb0fec6a6', 'kran-manipulyator', 1, 'Гидробак', 75.37, 58.18, NULL),
	('5abe701c-6219-4f1d-8350-fbbe1467afe3', 'kran-manipulyator', 2, 'Гидронасос', 64.13, 59.85, NULL),
	('87bf0f33-f416-44b5-8032-b85e4af5a97a', 'kran-manipulyator', 3, 'КОМ', 54.75, 61.60, NULL),
	('ab4c8c94-43c2-49d2-b9fd-763b4fa90060', 'kran-manipulyator', 4, 'Гидрораспределитель', 57.04, 50.03, NULL),
	('8a48d8fc-95e7-44da-8c9a-6f5412f22ac9', 'kran-manipulyator', 5, 'Кнопка пневмоуправления', 29.14, 48.31, NULL),
	('9128b7ae-e0e5-4efd-9182-bfc1c9e09207', 'musorovoz', 1, 'Кнопка пневмоуправления', 20.75, 45.02, NULL),
	('6e2d90b2-ff16-4c25-9b0f-6e612d510e14', 'musorovoz', 2, 'Гидрораспределитель', 94.39, 50.94, NULL),
	('5b984a57-7d03-43a4-97ce-fe9b57d0a656', 'musorovoz', 3, 'КОМ', 59.52, 63.65, NULL),
	('937447b7-d3b6-46ec-9a39-475b229663a8', 'musorovoz', 4, 'Гидронасос', 56.40, 56.15, NULL),
	('09834a7e-48e9-452d-b263-6cd401d86096', 'musorovoz', 5, 'Гидробак', 72.12, 55.50, NULL),
	('8ac161fd-0238-4ff4-9c42-26086193befa', 'avtovoz', 1, 'Гидрораспределитель', 78.50, 61.00, NULL),
	('2355dffb-08ff-45da-9935-5fe313d34fe1', 'avtovoz', 2, 'Гидробак', 56.58, 59.32, NULL),
	('e0a4196c-d9cb-4e31-ac18-d278d000a299', 'avtovoz', 3, 'КОМ', 44.98, 59.27, NULL),
	('43c73668-01e4-4e5b-afb0-641a2c8c396b', 'avtovoz', 4, 'Гидронасос', 49.68, 55.73, NULL),
	('1e794026-a51f-4cbd-ab93-909f61b102d6', 'avtovoz', 5, 'Кнопка пневмоуправления', 27.76, 50.55, NULL),
	('f87cd267-9651-4c17-a96f-aab86265f73a', 'samosval', 1, 'Гидронасос', 58.61, 64.49, 'cc878339-7506-4daa-8a4e-0c3add97da14'),
	('a6a74d44-1f0c-498f-98b8-8115934dbebe', 'samosval', 2, 'КОМ', 66.90, 58.20, NULL),
	('562edde5-bd65-47f0-b5bb-04ca800d86d3', 'samosval', 3, 'Джойстик подъёма/опускания', 44.43, 41.41, NULL),
	('60cc61a8-56e6-43ad-a7d1-6363314deb2b', 'samosval', 4, 'Распределитель', 64.60, 36.16, NULL),
	('46b95e65-881b-4081-a914-3e4763672926', 'samosval', 5, 'Гидробак за кабиной', 65.88, 45.77, NULL),
	('97dca5c7-7ea2-4179-8c70-5dd4f38eb243', 'tyagach', 1, 'Распределитель', 52.63, 72.02, NULL),
	('2a4f0e24-4bf4-4e5f-96d1-bff9d71be26b', 'tyagach', 2, 'Джойстик подъёма/опускания', 36.33, 69.41, NULL),
	('8ffca6e1-420f-4da2-997b-ac4620f737e5', 'tyagach', 3, 'Гидронасос', 45.81, 81.75, NULL),
	('6df76dfa-8624-4300-8745-2f72b8dff102', 'tyagach', 4, 'КОМ', 44.71, 74.72, NULL),
	('3f4c282e-885e-46df-8f8e-65995efb9a7e', 'tyagach', 5, 'Гидробак', 55.02, 78.25, NULL);


--
-- Name: admin_audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."admin_audit_log_id_seq"', 6, true);


--
-- PostgreSQL database dump complete
--

-- \unrestrict TL5kTih7ITj8aT8ZAloxTIH3rns3Ih7VrFP0uft0Brd3ZqWiDo2UGuCxszrh3b7

RESET ALL;
