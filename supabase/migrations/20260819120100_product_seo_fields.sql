-- SEO-поля формы товара (meta title/description) — независимые от
-- name/short_description, чтобы админ мог задать текст специально под
-- поисковую выдачу, не трогая контент, который видят покупатели.
ALTER TABLE "public"."products"
  ADD COLUMN "meta_title" "text",
  ADD COLUMN "meta_description" "text";
