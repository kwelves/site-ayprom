-- Очередь обработки фотографий для Cloudflare-админки.
--
-- Worker не умеет запускать Sharp, поэтому при сохранении товара фотографии из промежуточного хранилища
-- не обрабатываются сразу, а ставятся в очередь. Фоновый обработчик (GitHub Actions) берёт задания,
-- выполняет ту же обработку, что раньше делала Server Action, и привязывает фото к товару.
-- Очередь живёт в уже существующей таблице учёта промежуточных файлов.

ALTER TABLE "public"."product_image_staging"
  ADD COLUMN "queued_product_id" uuid,
  ADD COLUMN "queued_photo_mode" text,
  ADD COLUMN "queued_position" integer,
  ADD COLUMN "queued_at" timestamp with time zone,
  ADD COLUMN "lease_until" timestamp with time zone,
  ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "failed_at" timestamp with time zone;

ALTER TABLE ONLY "public"."product_image_staging"
  ADD CONSTRAINT "product_image_staging_queued_product_id_fkey" FOREIGN KEY ("queued_product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."product_image_staging"
  ADD CONSTRAINT "product_image_staging_queued_photo_mode_check" CHECK (("queued_photo_mode" IS NULL) OR ("queued_photo_mode" = ANY (ARRAY['normal'::"text", 'webp'::"text", 'script'::"text", 'script-webp'::"text"])));

ALTER TABLE ONLY "public"."product_image_staging"
  ADD CONSTRAINT "product_image_staging_attempts_check" CHECK (("attempts" >= 0) AND ("attempts" <= 3));

CREATE INDEX "product_image_staging_queue_idx" ON "public"."product_image_staging" USING "btree" ("queued_at", "queued_position") WHERE (("queued_at" IS NOT NULL) AND ("finalized_at" IS NULL) AND ("failed_at" IS NULL));

CREATE INDEX "product_image_staging_queued_product_idx" ON "public"."product_image_staging" USING "btree" ("queued_product_id") WHERE ("queued_at" IS NOT NULL);


-- Постановка в очередь. Порядок p_ids — порядок, в котором админ расставил снимки. Срок хранения
-- продлевается: файл должен пережить уборку брошенного, пока его не обработают.
CREATE OR REPLACE FUNCTION "public"."queue_product_image_staging"("p_draft" "uuid", "p_ids" "uuid"[], "p_product" "uuid", "p_mode" "text")
RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_count" integer;
begin
  if "p_draft" is null or "p_product" is null or "p_ids" is null or coalesce(array_length("p_ids", 1), 0) = 0 then
    raise exception 'invalid_photo_queue_request' using errcode = '22023';
  end if;
  if "p_mode" is null or "p_mode" not in ('normal', 'webp', 'script', 'script-webp') then
    raise exception 'invalid_photo_mode' using errcode = '22023';
  end if;
  if not exists (select 1 from "public"."products" where "id" = "p_product") then
    raise exception 'invalid_photo_queue_request' using errcode = '22023';
  end if;

  update "public"."product_image_staging"
  set "queued_product_id" = "p_product",
      "queued_photo_mode" = "p_mode",
      "queued_position" = array_position("p_ids", "id"),
      "queued_at" = now(),
      "expires_at" = now() + interval '48 hours'
  where "draft_id" = "p_draft"
    and "id" = any("p_ids")
    and "finalized_at" is null
    and "queued_at" is null
    and "expires_at" > now();

  get diagnostics "v_count" = row_count;
  return "v_count";
end;
$$;


-- Взять одно задание. Просроченная аренда освобождает задание для повторной попытки; после третьей
-- неудачной попытки задание помечается проваленным и больше не берётся.
CREATE OR REPLACE FUNCTION "public"."claim_queued_product_image_staging"("p_lease_seconds" integer DEFAULT 300)
RETURNS SETOF "public"."product_image_staging"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_id" uuid;
begin
  if "p_lease_seconds" is null or "p_lease_seconds" not between 5 and 900 then
    raise exception 'invalid_photo_lease' using errcode = '22023';
  end if;

  update "public"."product_image_staging"
  set "failed_at" = now(), "lease_until" = null
  where "queued_at" is not null and "finalized_at" is null and "failed_at" is null
    and "attempts" >= 3 and ("lease_until" is null or "lease_until" <= now());

  select "id" into "v_id"
  from "public"."product_image_staging"
  where "queued_at" is not null
    and "queued_product_id" is not null
    and "finalized_at" is null
    and "failed_at" is null
    and "attempts" < 3
    and "expires_at" > now()
    and ("lease_until" is null or "lease_until" <= now())
  order by "queued_at", "queued_position", "id"
  limit 1
  for update skip locked;

  if "v_id" is null then
    return;
  end if;

  return query
    update "public"."product_image_staging"
    set "attempts" = "attempts" + 1,
        "lease_until" = now() + make_interval(secs => "p_lease_seconds")
    where "id" = "v_id"
    returning *;
end;
$$;


-- Отметить неудачу: снять аренду (повторить позже) или сразу пометить проваленным.
CREATE OR REPLACE FUNCTION "public"."fail_queued_product_image_staging"("p_id" "uuid", "p_retry" boolean)
RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_updated" integer;
begin
  update "public"."product_image_staging"
  set "lease_until" = null,
      "failed_at" = case when "p_retry" is true and "attempts" < 3 then null else now() end
  where "id" = "p_id" and "finalized_at" is null and "queued_at" is not null;

  get diagnostics "v_updated" = row_count;
  return "v_updated" > 0;
end;
$$;


ALTER FUNCTION "public"."queue_product_image_staging"("p_draft" "uuid", "p_ids" "uuid"[], "p_product" "uuid", "p_mode" "text") OWNER TO "postgres";
ALTER FUNCTION "public"."claim_queued_product_image_staging"("p_lease_seconds" integer) OWNER TO "postgres";
ALTER FUNCTION "public"."fail_queued_product_image_staging"("p_id" "uuid", "p_retry" boolean) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."queue_product_image_staging"("p_draft" "uuid", "p_ids" "uuid"[], "p_product" "uuid", "p_mode" "text") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."claim_queued_product_image_staging"("p_lease_seconds" integer) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."fail_queued_product_image_staging"("p_id" "uuid", "p_retry" boolean) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."queue_product_image_staging"("p_draft" "uuid", "p_ids" "uuid"[], "p_product" "uuid", "p_mode" "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."claim_queued_product_image_staging"("p_lease_seconds" integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."fail_queued_product_image_staging"("p_id" "uuid", "p_retry" boolean) TO "service_role";
