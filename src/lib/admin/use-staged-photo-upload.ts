"use client";

import { useCallback, useRef, useState } from "react";
import { createProductImageUploadTicket } from "@/lib/admin/actions";
import { MAX_PRODUCT_IMAGES } from "@/lib/admin/image-validation";

// QA-004: каждая фотография грузится отдельно и напрямую в промежуточное
// хранилище, а не внутри общего запроса создания товара.
//
// Отсюда и требования плана: у каждой загрузки должен быть виден ход, её должно
// быть можно повторить после обрыва и отменить. Без этого независимая загрузка
// превращается в непрозрачное ожидание, из которого админ не понимает, что
// происходит и что делать при сбое.

export type StagedPhotoStatus = "uploading" | "uploaded" | "failed";

export interface StagedPhoto {
  /** Локальный ключ строки в интерфейсе; не совпадает с идентификатором учёта. */
  key: string;
  fileName: string;
  file: File;
  status: StagedPhotoStatus;
  progress: number;
  error?: string;
  /** Появляется после успешной загрузки; именно он передаётся при сохранении. */
  stagingId?: string;
}

/**
 * Загрузка обычным PUT, а не через клиент Supabase: только так доступен ход
 * выполнения. Проверено, что подписанная ссылка принимает такой запрос.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`Хранилище отклонило файл (${request.status}).`));
    request.onerror = () => reject(new Error("Не удалось соединиться с хранилищем."));
    request.onabort = () => reject(new DOMException("Отменено", "AbortError"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export function useStagedPhotoUpload(draftId: string) {
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const abortControllers = useRef(new Map<string, AbortController>());

  const update = useCallback((key: string, patch: Partial<StagedPhoto>) => {
    setPhotos((previous) => previous.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }, []);

  const upload = useCallback(
    async (key: string, file: File) => {
      const controller = new AbortController();
      abortControllers.current.set(key, controller);
      update(key, { status: "uploading", progress: 0, error: undefined });

      try {
        // Пропуск выдаёт сервер: он же проверяет тип, размер и лимит количества.
        const ticket = await createProductImageUploadTicket(draftId, file.type, file.size);
        await putWithProgress(
          ticket.signedUrl,
          file,
          (percent) => update(key, { progress: percent }),
          controller.signal,
        );
        update(key, { status: "uploaded", progress: 100, stagingId: ticket.stagingId });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        update(key, {
          status: "failed",
          error: error instanceof Error ? error.message : "Не удалось загрузить фотографию.",
        });
      } finally {
        abortControllers.current.delete(key);
      }
    },
    [draftId, update],
  );

  const addFiles = useCallback(
    (files: File[]): string | null => {
      let rejected: string | null = null;
      setPhotos((previous) => {
        const free = MAX_PRODUCT_IMAGES - previous.length;
        if (free <= 0) {
          rejected = `Можно загрузить не более ${MAX_PRODUCT_IMAGES} фотографий товара.`;
          return previous;
        }
        if (files.length > free) {
          rejected = `Добавлены не все файлы: осталось мест — ${free}.`;
        }
        const accepted = files.slice(0, free).map((file) => ({
          key: crypto.randomUUID(),
          fileName: file.name,
          file,
          status: "uploading" as const,
          progress: 0,
        }));
        // Загрузка запускается вне setState: обновление состояния должно
        // оставаться чистым.
        queueMicrotask(() => accepted.forEach((photo) => void upload(photo.key, photo.file)));
        return [...previous, ...accepted];
      });
      return rejected;
    },
    [upload],
  );

  const retry = useCallback(
    (key: string) => {
      const photo = photos.find((p) => p.key === key);
      if (photo) void upload(key, photo.file);
    },
    [photos, upload],
  );

  /**
   * Отмена убирает снимок из списка на прикрепление. Уже загруженный файл
   * остаётся в промежуточном хранилище, но при сохранении не передаётся и будет
   * убран по сроку — прикрепить отменённое было бы хуже, чем подождать уборку.
   */
  const cancel = useCallback((key: string) => {
    abortControllers.current.get(key)?.abort();
    abortControllers.current.delete(key);
    setPhotos((previous) => previous.filter((p) => p.key !== key));
  }, []);

  const reset = useCallback(() => {
    abortControllers.current.forEach((controller) => controller.abort());
    abortControllers.current.clear();
    setPhotos([]);
  }, []);

  return {
    photos,
    addFiles,
    retry,
    cancel,
    reset,
    /** Идентификаторы для прикрепления — в порядке, заданном администратором. */
    stagingIds: photos.filter((p) => p.stagingId).map((p) => p.stagingId as string),
    isUploading: photos.some((p) => p.status === "uploading"),
    hasFailures: photos.some((p) => p.status === "failed"),
    uploadedCount: photos.filter((p) => p.status === "uploaded").length,
  };
}
