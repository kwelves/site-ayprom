-- Визуальный масштаб (множитель transform: scale()) до сих пор записывался как
-- произвольный numeric: ни UI, ни сервер, ни БД не имели границы, поэтому
-- опечатка «100» вместо «1.00» или отрицательное значение молча ломали вёрстку
-- публичной страницы.
--
-- Границы выбраны по измерению фактических данных, а не назначены произвольно:
-- на момент миграции все заполненные значения каталога лежат в 0.75–1.6
-- (product_images.scale не заполнен ни разу). Диапазон 0.1–5.0 оставляет более
-- чем трёхкратный запас сверху и при этом отсекает ноль, отрицательные значения
-- и порядковые опечатки. NULL сохраняет прежний смысл «без масштабирования».
--
-- Нормализация выполняется до установки констрейнтов, чтобы миграция была
-- самодостаточной в любой среде: если где-то уже лежит значение вне диапазона,
-- оно приводится к ближайшей границе, а не блокирует применение миграции.

UPDATE "public"."product_images"
SET "scale" = LEAST(GREATEST("scale", 0.1), 5.0)
WHERE "scale" IS NOT NULL AND ("scale" < 0.1 OR "scale" > 5.0);

UPDATE "public"."brands"
SET "logo_scale" = LEAST(GREATEST("logo_scale", 0.1), 5.0)
WHERE "logo_scale" IS NOT NULL AND ("logo_scale" < 0.1 OR "logo_scale" > 5.0);

UPDATE "public"."category_brands"
SET "logo_scale_override" = LEAST(GREATEST("logo_scale_override", 0.1), 5.0)
WHERE "logo_scale_override" IS NOT NULL AND ("logo_scale_override" < 0.1 OR "logo_scale_override" > 5.0);

ALTER TABLE "public"."product_images"
  ADD CONSTRAINT "product_images_scale_bounds_check"
  CHECK (("scale" IS NULL) OR ("scale" >= 0.1 AND "scale" <= 5.0));

ALTER TABLE "public"."brands"
  ADD CONSTRAINT "brands_logo_scale_bounds_check"
  CHECK (("logo_scale" IS NULL) OR ("logo_scale" >= 0.1 AND "logo_scale" <= 5.0));

ALTER TABLE "public"."category_brands"
  ADD CONSTRAINT "category_brands_logo_scale_override_bounds_check"
  CHECK (("logo_scale_override" IS NULL) OR ("logo_scale_override" >= 0.1 AND "logo_scale_override" <= 5.0));
