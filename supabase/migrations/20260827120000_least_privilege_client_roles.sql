-- QA-013: клиентские роли `anon` и `authenticated` имеют на таблицах каталога
-- права, которые публичному сайту не нужны, и которые RLS не контролирует.
--
-- RLS ограничивает только строковые операции (SELECT/INSERT/UPDATE/DELETE).
-- TRUNCATE, REFERENCES, TRIGGER и MAINTAIN работают на уровне таблицы целиком
-- и политиками не проверяются вовсе: `truncate products cascade` под ролью
-- `anon` очищает каталог вместе с фотографиями, характеристиками, связями
-- брендов, типами техники и hotspot'ами, несмотря на включённый RLS. Проверено
-- на локальной базе внутри откаченной транзакции: 12 товаров → 0.
--
-- Источник прав — не наши миграции, а default privileges схемы `public`:
-- новая таблица, созданная ролью `postgres`, автоматически получает набор прав
-- для `anon`/`authenticated`. Поэтому одного разового REVOKE мало — без правки
-- default privileges следующая же миграция вернёт проблему на новых объектах.
--
-- Здесь оба уровня приводятся к минимально необходимому: публичный каталог
-- читает 11 таблиц и вызывает две функции поиска, всё остальное принадлежит
-- `service_role`.

-- 1. Default privileges: новые объекты больше не достаются клиентским ролям.
--
-- `FOR ROLE "postgres"` — потому что миграции выполняются именно от неё и
-- владельцем создаваемых объектов становится она. Параллельный набор default
-- privileges роли `supabase_admin` намеренно не трогается: он принадлежит
-- платформе, наши миграции объектов от этой роли не создают, а членства в ней
-- у `postgres` на hosted-проекте нет — попытка изменить его сломала бы выкатку.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM PUBLIC, "anon", "authenticated";

-- Отдельная строка без `IN SCHEMA` — не дубль предыдущей.
--
-- Встроенное умолчание Postgres для функций содержит EXECUTE для PUBLIC, а
-- итоговые права нового объекта считаются как ОБЪЕДИНЕНИЕ глобальной и
-- схемной записи default privileges; при отсутствии глобальной записи её место
-- занимает то самое встроенное умолчание. Поэтому схемный REVOKE выше снимает
-- явные `anon`/`authenticated`, но PUBLIC возвращается через объединение —
-- проверено: новая функция получала ACL `{=X/postgres,...}`. Глобальная запись
-- убирает PUBLIC из обеих половин объединения. Таблиц и последовательностей
-- это не касается: у них во встроенном умолчании PUBLIC нет.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Серверная часть (admin, cron) ходит только под `service_role`, поэтому её
-- доступ к новым объектам подтверждается явно, а не остаётся побочным эффектом.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

-- 2. Уже существующие объекты. REVOKE идёт по всей схеме, а не по списку имён:
-- список пришлось бы поддерживать вручную, и пропущенная таблица осталась бы
-- открытой молча.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon", "authenticated";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC, "anon", "authenticated";

GRANT ALL ON ALL TABLES IN SCHEMA "public" TO "service_role";
GRANT ALL ON ALL SEQUENCES IN SCHEMA "public" TO "service_role";
GRANT ALL ON ALL FUNCTIONS IN SCHEMA "public" TO "service_role";

-- 3. Ровно то, что нужно публичному каталогу: чтение одиннадцати таблиц.
-- Строки при этом по-прежнему фильтрует RLS (`published = true` и связанные с
-- ним политики) — GRANT здесь только открывает саму возможность SELECT.
GRANT SELECT ON TABLE "public"."brands" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."categories" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."category_brands" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."product_brands" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."product_characteristics" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."product_images" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."product_vehicle_types" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."products" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."subcategories" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."vehicle_hotspots" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."vehicle_types" TO "anon", "authenticated";

-- Поиск каталога. `search_catalog_products` — SQL-функция с правами
-- вызывающего, и внутри она обращается к `normalize_catalog_search`; проверка
-- прав на вложенный вызов выполняется для той же роли, поэтому обеим нужен
-- явный EXECUTE. Раньше вторая функция держалась на умолчании «EXECUTE для
-- PUBLIC», которое мы только что сняли.
GRANT EXECUTE ON FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") TO "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."normalize_catalog_search"("value" "text") TO "anon", "authenticated";
