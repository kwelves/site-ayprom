-- Информационный статус наличия товара — не влияет на публичную видимость
-- (публичная политика RLS уже фильтрует только по published, этот столбец
-- ей не нужен). Бэкофилл существующих строк на 'in_stock' происходит
-- автоматически через DEFAULT при ADD COLUMN — метадата-операция, без
-- переписывания страниц таблицы.
CREATE TYPE "public"."product_availability" AS ENUM ('in_stock', 'out_of_stock', 'unclear');

ALTER TABLE "public"."products"
  ADD COLUMN "availability" "public"."product_availability" NOT NULL DEFAULT 'in_stock';
