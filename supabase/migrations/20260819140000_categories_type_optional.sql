-- «Напрямую» категория (type = NULL) — товары показываются плоским
-- списком/сеткой без группировки по подкатегориям или брендам. Существующие
-- категории не затронуты: у всех уже заполнен type.
ALTER TABLE "public"."categories" ALTER COLUMN "type" DROP NOT NULL;

ALTER TABLE "public"."categories" DROP CONSTRAINT "categories_type_check";
ALTER TABLE "public"."categories"
  ADD CONSTRAINT "categories_type_check"
  CHECK (("type" IS NULL) OR ("type" = ANY (ARRAY['subcategory'::"text", 'brand'::"text"])));
