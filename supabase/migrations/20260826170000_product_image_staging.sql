-- QA-004: создание товара передавало все фотографии внутри одного запроса
-- Server Action. Десять файлов по 8 МБ — это 80 МБ в одном запросе плюс их
-- последовательная обработка, всё в рамках общего бюджета времени и памяти
-- функции. Одна медленная фотография ставила под угрозу создание товара
-- целиком.
--
-- Новый порядок: браузер грузит каждый файл отдельно и напрямую в приватное
-- промежуточное хранилище по короткоживущей ссылке, а сервер затем проверяет
-- содержимое повторно и только после этого переносит файл в публичное
-- хранилище и привязывает к товару.
--
-- Таблица ниже — учёт того, что лежит в промежуточном хранилище: без неё
-- невозможно ни ограничить количество файлов, ни убрать брошенное.
--
-- Важное ограничение, обнаруженное при проверке: Supabase запрещает удалять
-- файлы напрямую из SQL (триггер storage.protect_delete). Поэтому уборка
-- устроена в два шага: база отдаёт список просроченного, а удаляет файлы
-- приложение через Storage API. Функции ниже поддерживают именно такой порядок.


-- Приватное промежуточное хранилище. Публичным оно быть не должно: файл в нём
-- ещё не прошёл повторную проверку и не является частью каталога.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-image-staging',
  'product-image-staging',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


CREATE TABLE IF NOT EXISTS "public"."product_image_staging" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    -- Одна сессия формы: позволяет ограничить количество файлов и убрать всё
    -- разом, если админ отменил создание товара.
    "draft_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "byte_size" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    -- Проставляется, когда файл успешно перенесён в публичное хранилище и
    -- привязан к товару. Такая строка больше не подлежит уборке по сроку.
    "finalized_at" timestamp with time zone,
    CONSTRAINT "product_image_staging_byte_size_check" CHECK ((("byte_size" > 0) AND ("byte_size" <= 8388608))),
    CONSTRAINT "product_image_staging_expiry_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "product_image_staging_content_type_check" CHECK (("content_type" = ANY (ARRAY['image/jpeg'::"text", 'image/png'::"text", 'image/webp'::"text", 'image/avif'::"text"])))
);


ALTER TABLE "public"."product_image_staging" OWNER TO "postgres";

ALTER TABLE ONLY "public"."product_image_staging"
    ADD CONSTRAINT "product_image_staging_pkey" PRIMARY KEY ("id");

-- Путь в хранилище уникален: повторная выдача ссылки на тот же путь не должна
-- создавать вторую учётную запись, иначе один файл посчитается дважды.
ALTER TABLE ONLY "public"."product_image_staging"
    ADD CONSTRAINT "product_image_staging_object_path_key" UNIQUE ("object_path");

CREATE INDEX "product_image_staging_draft_idx" ON "public"."product_image_staging" USING "btree" ("draft_id");

-- Частичный индекс: уборку интересуют только незавершённые записи.
CREATE INDEX "product_image_staging_expiry_idx" ON "public"."product_image_staging" USING "btree" ("expires_at") WHERE ("finalized_at" IS NULL);

ALTER TABLE "public"."product_image_staging" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."product_image_staging" FROM "anon";
REVOKE ALL ON TABLE "public"."product_image_staging" FROM "authenticated";
REVOKE ALL ON TABLE "public"."product_image_staging" FROM PUBLIC;
GRANT ALL ON TABLE "public"."product_image_staging" TO "service_role";


-- Регистрация намерения загрузить файл.
--
-- Лимит количества проверяется здесь, а не в приложении: это единственное
-- место, где видно всю сессию сразу, и его нельзя обойти повторным запросом.
CREATE OR REPLACE FUNCTION "public"."claim_product_image_staging"(
  "p_draft_id" "uuid",
  "p_object_path" "text",
  "p_content_type" "text",
  "p_byte_size" bigint,
  "p_ttl_seconds" integer,
  "p_max_files" integer
) RETURNS TABLE("out_id" "uuid", "out_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_active" integer;
  "v_expires_at" timestamp with time zone;
  "v_id" "uuid";
begin
  if "p_draft_id" is null then
    raise exception 'Не передан идентификатор сессии загрузки.' using errcode = '22023';
  end if;
  if coalesce(btrim("p_object_path"), '') = '' then
    raise exception 'Не передан путь файла.' using errcode = '22023';
  end if;
  if "p_ttl_seconds" is null or "p_ttl_seconds" <= 0 then
    raise exception 'Некорректный срок хранения.' using errcode = '22023';
  end if;
  if "p_max_files" is null or "p_max_files" <= 0 then
    raise exception 'Некорректный лимит количества файлов.' using errcode = '22023';
  end if;

  -- Считаем только незавершённые и непросроченные: просроченные всё равно
  -- будут убраны и не должны блокировать работу.
  select count(*) into "v_active"
  from "public"."product_image_staging"
  where "draft_id" = "p_draft_id"
    and "finalized_at" is null
    and "expires_at" > now();

  if "v_active" >= "p_max_files" then
    raise exception 'Можно загрузить не более % фотографий товара.', "p_max_files" using errcode = '22023';
  end if;

  "v_expires_at" := now() + make_interval(secs => "p_ttl_seconds");

  insert into "public"."product_image_staging" (
    "draft_id", "object_path", "content_type", "byte_size", "expires_at"
  ) values (
    "p_draft_id", btrim("p_object_path"), "p_content_type", "p_byte_size", "v_expires_at"
  )
  returning "product_image_staging"."id" into "v_id";

  return query select "v_id", "v_expires_at";
end;
$$;


ALTER FUNCTION "public"."claim_product_image_staging"("p_draft_id" "uuid", "p_object_path" "text", "p_content_type" "text", "p_byte_size" bigint, "p_ttl_seconds" integer, "p_max_files" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."claim_product_image_staging"("p_draft_id" "uuid", "p_object_path" "text", "p_content_type" "text", "p_byte_size" bigint, "p_ttl_seconds" integer, "p_max_files" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_product_image_staging"("p_draft_id" "uuid", "p_object_path" "text", "p_content_type" "text", "p_byte_size" bigint, "p_ttl_seconds" integer, "p_max_files" integer) TO "service_role";


-- Список того, что подлежит уборке. База только сообщает; удаляет файлы
-- приложение через Storage API, потому что напрямую из SQL это запрещено.
CREATE OR REPLACE FUNCTION "public"."list_abandoned_product_image_staging"("p_limit" integer DEFAULT 100)
RETURNS TABLE("out_id" "uuid", "out_object_path" "text")
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select "id", "object_path"
  from "public"."product_image_staging"
  where "finalized_at" is null and "expires_at" <= now()
  order by "expires_at"
  limit greatest(coalesce("p_limit", 100), 1);
$$;


ALTER FUNCTION "public"."list_abandoned_product_image_staging"("p_limit" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_abandoned_product_image_staging"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_abandoned_product_image_staging"("p_limit" integer) TO "service_role";


-- Снятие учётных записей после того, как приложение удалило сами файлы.
-- Идемпотентна: повторный вызов с теми же идентификаторами безвреден, что важно
-- для повторов уборки после частичного сбоя.
CREATE OR REPLACE FUNCTION "public"."release_product_image_staging"("p_ids" "uuid"[])
RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_deleted" integer;
begin
  if "p_ids" is null or coalesce(array_length("p_ids", 1), 0) = 0 then
    return 0;
  end if;

  delete from "public"."product_image_staging" where "id" = any("p_ids");
  get diagnostics "v_deleted" = row_count;
  return "v_deleted";
end;
$$;


ALTER FUNCTION "public"."release_product_image_staging"("p_ids" "uuid"[]) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."release_product_image_staging"("p_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_product_image_staging"("p_ids" "uuid"[]) TO "service_role";


-- Отметка о завершении: файл перенесён в публичное хранилище и привязан к
-- товару. Повторный вызов не меняет уже проставленное время — это делает
-- повтор завершения безопасным.
CREATE OR REPLACE FUNCTION "public"."finalize_product_image_staging"("p_id" "uuid")
RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_updated" integer;
begin
  update "public"."product_image_staging"
  set "finalized_at" = now()
  where "id" = "p_id" and "finalized_at" is null;

  get diagnostics "v_updated" = row_count;
  return "v_updated" > 0;
end;
$$;


ALTER FUNCTION "public"."finalize_product_image_staging"("p_id" "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."finalize_product_image_staging"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_product_image_staging"("p_id" "uuid") TO "service_role";
