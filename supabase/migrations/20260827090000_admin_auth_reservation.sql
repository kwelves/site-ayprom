-- QA-005: проверка пароля выполнялась ДО проверки лимита.
--
-- `login` сначала вызывал `verifyAdminPassword` (PBKDF2 — намеренно дорогая
-- операция), и только потом `registerLoginAttempt`. Заблокированный
-- перебирающий всё равно заставлял сервер считать хеш на каждом запросе: сама
-- защита превращалась в усилитель нагрузки. То же самое было в смене пароля.
--
-- Новый порядок: сначала атомарная бронь (`begin_admin_auth_attempt`), и
-- только если она выдана — PBKDF2, затем завершение брони
-- (`finish_admin_auth_attempt`). Заблокированный запрос не доходит до хеша.
--
-- Прежний `register_admin_login_attempt` намеренно НЕ удаляется: политика
-- отката плана требует сначала выкатить совместимые RPC, затем приложение, и
-- убирать старый контракт отдельной поздней миграцией.


-- Бронь существует только между началом и концом одной попытки. Её задача —
-- ограничить число одновременно допущенных к PBKDF2 запросов и не потерять
-- учёт, если процесс умер после выдачи брони.
CREATE TABLE IF NOT EXISTS "public"."admin_auth_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key_hash" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "admin_auth_reservations_scope_check" CHECK (("scope" = ANY (ARRAY['login'::"text", 'password-change'::"text"]))),
    CONSTRAINT "admin_auth_reservations_key_hash_check" CHECK (("length"("key_hash") = 64)),
    CONSTRAINT "admin_auth_reservations_expiry_check" CHECK (("expires_at" > "created_at"))
);

ALTER TABLE "public"."admin_auth_reservations" OWNER TO "postgres";

ALTER TABLE ONLY "public"."admin_auth_reservations"
    ADD CONSTRAINT "admin_auth_reservations_pkey" PRIMARY KEY ("id");

-- Частичный индекс: и подсчёт занятых броней, и сверка просроченных смотрят
-- только на незавершённые.
CREATE INDEX "admin_auth_reservations_active_idx"
    ON "public"."admin_auth_reservations" USING "btree" ("key_hash", "expires_at")
    WHERE ("finished_at" IS NULL);

ALTER TABLE "public"."admin_auth_reservations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."admin_auth_reservations" FROM "anon";
REVOKE ALL ON TABLE "public"."admin_auth_reservations" FROM "authenticated";
REVOKE ALL ON TABLE "public"."admin_auth_reservations" FROM PUBLIC;
GRANT ALL ON TABLE "public"."admin_auth_reservations" TO "service_role";


-- Учёт одной неудачной попытки. Вынесен отдельно, потому что нужен и обычному
-- завершению брони, и сверке брошенных: правило блокировки должно быть ровно
-- одно, иначе два пути начнут расходиться.
--
-- Переменные намеренно не называются `current_time`: это зарезервированное
-- слово, и внутри SQL-выражений парсер разрешает его в CURRENT_TIME (timetz),
-- из-за чего все сравнения падали с 42883. Эта ошибка уже была в проекте —
-- см. комментарий в register_admin_login_attempt.
CREATE OR REPLACE FUNCTION "public"."record_admin_auth_failure"(
  "p_key_hash" "text",
  "p_scope" "text",
  "p_attempt_at" timestamp with time zone
) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_row" "public"."admin_login_rate_limits"%rowtype;
  "v_failed_count" integer;
  "v_window_started_at" timestamp with time zone;
  "v_blocked_until" timestamp with time zone;
begin
  select * into "v_row"
  from "public"."admin_login_rate_limits"
  where "key_hash" = "p_key_hash"
  for update;

  if not found or "v_row"."window_started_at" < "p_attempt_at" - interval '15 minutes' then
    "v_failed_count" := 1;
    "v_window_started_at" := "p_attempt_at";
  else
    "v_failed_count" := "v_row"."failed_count" + 1;
    "v_window_started_at" := "v_row"."window_started_at";
  end if;

  "v_blocked_until" := case
    when "v_failed_count" >= 5 then "p_attempt_at" + interval '15 minutes'
    else null
  end;

  insert into "public"."admin_login_rate_limits" (
    "key_hash", "failed_count", "window_started_at", "last_attempt_at", "blocked_until"
  ) values (
    "p_key_hash", "v_failed_count", "v_window_started_at", "p_attempt_at", "v_blocked_until"
  )
  on conflict ("key_hash") do update
  set "failed_count" = excluded."failed_count",
      "window_started_at" = excluded."window_started_at",
      "last_attempt_at" = excluded."last_attempt_at",
      "blocked_until" = excluded."blocked_until";

  insert into "public"."admin_auth_events" ("scope", "outcome", "attempt_key_hash")
  values ("p_scope", case when "v_blocked_until" is null then 'failure' else 'blocked' end, "p_key_hash");

  if "v_blocked_until" is not null then
    return ceil(extract(epoch from ("v_blocked_until" - "p_attempt_at")))::integer;
  end if;
  return 0;
end;
$$;


ALTER FUNCTION "public"."record_admin_auth_failure"("p_key_hash" "text", "p_scope" "text", "p_attempt_at" timestamp with time zone) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."record_admin_auth_failure"("p_key_hash" "text", "p_scope" "text", "p_attempt_at" timestamp with time zone) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."record_admin_auth_failure"("p_key_hash" "text", "p_scope" "text", "p_attempt_at" timestamp with time zone) TO "service_role";


-- Бронь ДО проверки пароля. Возвращает разрешение, а не выполняет работу.
CREATE OR REPLACE FUNCTION "public"."begin_admin_auth_attempt"(
  "p_key_hash" "text",
  "p_scope" "text",
  "p_ttl_seconds" integer,
  "p_max_concurrent" integer
) RETURNS TABLE("out_allowed" boolean, "out_retry_after" integer, "out_reservation_id" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_attempt_at" timestamp with time zone := clock_timestamp();
  "v_row" "public"."admin_login_rate_limits"%rowtype;
  "v_active" integer;
  "v_id" "uuid";
  "v_abandoned" record;
begin
  if "p_scope" not in ('login', 'password-change') then
    raise exception 'invalid admin auth scope' using errcode = '22023';
  end if;
  if "p_key_hash" is null or length("p_key_hash") <> 64 then
    raise exception 'invalid admin auth key' using errcode = '22023';
  end if;
  if "p_ttl_seconds" is null or "p_ttl_seconds" <= 0 then
    raise exception 'invalid admin auth reservation ttl' using errcode = '22023';
  end if;
  if "p_max_concurrent" is null or "p_max_concurrent" <= 0 then
    raise exception 'invalid admin auth concurrency budget' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended("p_key_hash", 0));

  -- Сверка брошенных броней этого ключа. Бронь, по которой процесс не вернулся,
  -- означает израсходованный бюджет PBKDF2 с неизвестным исходом; она
  -- засчитывается как неудача. Иначе обрыв соединения на середине стал бы
  -- способом перебирать пароли, не увеличивая счётчик.
  for "v_abandoned" in
    select "id", "scope" from "public"."admin_auth_reservations"
    where "key_hash" = "p_key_hash" and "finished_at" is null and "expires_at" <= "v_attempt_at"
    for update
  loop
    update "public"."admin_auth_reservations"
    set "finished_at" = "v_attempt_at"
    where "id" = "v_abandoned"."id";
    perform "public"."record_admin_auth_failure"("p_key_hash", "v_abandoned"."scope", "v_attempt_at");
  end loop;

  select * into "v_row"
  from "public"."admin_login_rate_limits"
  where "key_hash" = "p_key_hash"
  for update;

  -- Заблокирован — возвращаемся немедленно, до какой-либо дорогой работы.
  if found and "v_row"."blocked_until" is not null and "v_row"."blocked_until" > "v_attempt_at" then
    insert into "public"."admin_auth_events" ("scope", "outcome", "attempt_key_hash")
    values ("p_scope", 'blocked', "p_key_hash");
    return query select false, greatest(1, ceil(extract(epoch from ("v_row"."blocked_until" - "v_attempt_at")))::integer), null::"uuid";
    return;
  end if;

  -- Бюджет одновременности: без него параллельный залп успел бы пройти
  -- проверку счётчика до того, как хоть одна попытка его увеличила.
  select count(*) into "v_active"
  from "public"."admin_auth_reservations"
  where "key_hash" = "p_key_hash" and "finished_at" is null and "expires_at" > "v_attempt_at";

  if "v_active" >= "p_max_concurrent" then
    insert into "public"."admin_auth_events" ("scope", "outcome", "attempt_key_hash")
    values ("p_scope", 'blocked', "p_key_hash");
    return query select false, 1, null::"uuid";
    return;
  end if;

  insert into "public"."admin_auth_reservations" ("key_hash", "scope", "expires_at")
  values ("p_key_hash", "p_scope", "v_attempt_at" + make_interval(secs => "p_ttl_seconds"))
  returning "admin_auth_reservations"."id" into "v_id";

  return query select true, 0, "v_id";
end;
$$;


ALTER FUNCTION "public"."begin_admin_auth_attempt"("p_key_hash" "text", "p_scope" "text", "p_ttl_seconds" integer, "p_max_concurrent" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."begin_admin_auth_attempt"("p_key_hash" "text", "p_scope" "text", "p_ttl_seconds" integer, "p_max_concurrent" integer) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."begin_admin_auth_attempt"("p_key_hash" "text", "p_scope" "text", "p_ttl_seconds" integer, "p_max_concurrent" integer) TO "service_role";


-- Завершение брони после проверки пароля. Идемпотентно: повторный вызов с тем
-- же идентификатором ничего не считает второй раз.
CREATE OR REPLACE FUNCTION "public"."finish_admin_auth_attempt"(
  "p_reservation_id" "uuid",
  "p_password_is_valid" boolean
) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_attempt_at" timestamp with time zone := clock_timestamp();
  "v_reservation" "public"."admin_auth_reservations"%rowtype;
begin
  if "p_reservation_id" is null then
    raise exception 'missing admin auth reservation' using errcode = '22023';
  end if;

  select * into "v_reservation"
  from "public"."admin_auth_reservations"
  where "id" = "p_reservation_id";

  -- Неизвестная бронь: сообщаем ошибкой, а не молча успехом — вызывающий обязан
  -- закрыться fail-closed, иначе исчезновение учёта выглядело бы как успех.
  if not found then
    raise exception 'unknown admin auth reservation' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended("v_reservation"."key_hash", 0));

  -- Уже завершена (повтор или сверка успела засчитать её как брошенную) —
  -- второй раз не учитываем.
  if "v_reservation"."finished_at" is not null then
    return 0;
  end if;

  update "public"."admin_auth_reservations"
  set "finished_at" = "v_attempt_at"
  where "id" = "p_reservation_id";

  if "p_password_is_valid" then
    delete from "public"."admin_login_rate_limits" where "key_hash" = "v_reservation"."key_hash";
    insert into "public"."admin_auth_events" ("scope", "outcome", "attempt_key_hash")
    values ("v_reservation"."scope", 'success', "v_reservation"."key_hash");
    return 0;
  end if;

  return "public"."record_admin_auth_failure"("v_reservation"."key_hash", "v_reservation"."scope", "v_attempt_at");
end;
$$;


ALTER FUNCTION "public"."finish_admin_auth_attempt"("p_reservation_id" "uuid", "p_password_is_valid" boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."finish_admin_auth_attempt"("p_reservation_id" "uuid", "p_password_is_valid" boolean) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."finish_admin_auth_attempt"("p_reservation_id" "uuid", "p_password_is_valid" boolean) TO "service_role";
