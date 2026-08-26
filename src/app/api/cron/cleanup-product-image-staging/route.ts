import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CLEANUP_BATCH_LIMIT,
  PRODUCT_IMAGE_STAGING_BUCKET,
} from "@/lib/admin/product-image-staging";

// QA-004: уборка брошенной промежуточной загрузки.
//
// Почему это адрес приложения, а не задание внутри базы: Supabase намеренно
// запрещает удалять файлы напрямую из SQL (триггер storage.protect_delete) —
// удаление записи оставило бы файл висеть навсегда. Удалять умеет только
// Storage API, а ключ доступа к нему должен жить на сервере приложения, а не
// внутри базы.
//
// Поэтому обязанности разделены: база отдаёт список просроченного, приложение
// удаляет файлы и только затем снимает учётные записи. Порядок именно такой —
// если снять запись раньше, а удаление файла сорвётся, файл станет мусором,
// про который уже никто не знает.

export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail-closed: без настроенного секрета адрес не работает вовсе. Открытый
  // адрес уборки позволил бы любому желающему удалять чужие незавершённые
  // загрузки.
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ status: "forbidden" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    const { data: abandoned, error: listError } = await supabase.rpc(
      "list_abandoned_product_image_staging",
      { p_limit: CLEANUP_BATCH_LIMIT },
    );
    if (listError) throw listError;

    const rows = (abandoned ?? []) as Array<{ out_id: string; out_object_path: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ status: "ok", removed: 0 });
    }

    // Удаление отсутствующего объекта не считается ошибкой, поэтому повторный
    // запуск после частичного сбоя безопасен.
    const { error: removeError } = await supabase.storage
      .from(PRODUCT_IMAGE_STAGING_BUCKET)
      .remove(rows.map((row) => row.out_object_path));
    if (removeError) throw removeError;

    const { data: released, error: releaseError } = await supabase.rpc(
      "release_product_image_staging",
      { p_ids: rows.map((row) => row.out_id) },
    );
    if (releaseError) throw releaseError;

    // Учёт остаётся видимым: без него нельзя заметить, что уборка перестала
    // справляться с объёмом.
    console.info("Уборка промежуточной загрузки", {
      candidates: rows.length,
      released,
      batchLimit: CLEANUP_BATCH_LIMIT,
    });

    return NextResponse.json({
      status: "ok",
      removed: released ?? 0,
      // Признак того, что за один запуск разобрать всё не удалось: значит
      // расписание нужно чаще либо объём вырос.
      truncated: rows.length >= CLEANUP_BATCH_LIMIT,
    });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
