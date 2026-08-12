"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { previewProductImport, commitProductImport, type ImportCommitResult } from "@/lib/admin/product-import-actions";
import type { ImportPreview, ParsedImportRow } from "@/lib/admin/product-import-parse";

type Stage = { name: "idle" } | { name: "preview"; preview: ImportPreview } | { name: "done"; result: ImportCommitResult };

export function ImportProducts() {
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      try {
        const preview = await previewProductImport(formData);
        setStage({ name: "preview", preview });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось прочитать файл.");
      }
    });
  }

  function handleConfirm(rows: ParsedImportRow[]) {
    startTransition(async () => {
      try {
        const result = await commitProductImport(rows);
        setStage({ name: "done", result });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Импорт не выполнен.");
      }
    });
  }

  function handleReset() {
    setStage({ name: "idle" });
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {stage.name === "idle" && (
        <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border bg-muted/20 p-6">
          <div className="flex items-center gap-3 text-muted-foreground">
            <UploadCloud aria-hidden="true" className="h-6 w-6" />
            <p className="text-sm">
              Выберите CSV-файл с товарами. Обязательные колонки: <code>name</code>, <code>category</code>,{" "}
              <code>short_description</code>. Необязательные: <code>article</code>, <code>subcategory</code>,{" "}
              <code>description</code>, <code>published</code>, <code>brands</code>, <code>vehicle_types</code>,{" "}
              <code>characteristics</code>. Списки — через «;», характеристики — «Атрибут=Значение;…».
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover">
            {isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Выбрать файл
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              disabled={isPending}
              className="sr-only"
            />
          </label>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-surface p-3 text-sm text-danger">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {stage.name === "preview" && (
        <ImportPreviewPanel
          preview={stage.preview}
          isPending={isPending}
          onConfirm={handleConfirm}
          onCancel={handleReset}
        />
      )}

      {stage.name === "done" && <ImportResultPanel result={stage.result} onReset={handleReset} />}
    </div>
  );
}

function ImportPreviewPanel({
  preview,
  isPending,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreview;
  isPending: boolean;
  onConfirm: (rows: ParsedImportRow[]) => void;
  onCancel: () => void;
}) {
  const toCreate = preview.validRows.filter((r) => !r.matchedExisting).length;
  const toUpdate = preview.validRows.length - toCreate;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card p-4 text-sm">
        <span className="font-medium text-card-foreground">Прочитано строк: {preview.totalRows}</span>
        <span className="text-success">Создать: {toCreate}</span>
        <span className="text-accent-foreground">Обновить: {toUpdate}</span>
        {preview.errors.length > 0 && <span className="text-danger">Ошибок: {preview.errors.length}</span>}
      </div>

      {preview.errors.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-md border border-danger-border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-danger-surface text-danger">
              <tr>
                <th className="px-3 py-2 font-medium">Строка</th>
                <th className="px-3 py-2 font-medium">Ошибка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-danger-surface-hover">
              {preview.errors.map((rowError, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-danger">{rowError.rowIndex + 2}</td>
                  <td className="px-3 py-2 text-danger">{rowError.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.validRows.length > 0 && (
        <div className="max-h-96 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium text-muted-foreground">Строка</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Название</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Артикул</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {preview.validRows.map((row) => (
                <tr key={row.rowIndex}>
                  <td className="px-3 py-2 text-muted-foreground">{row.rowIndex + 2}</td>
                  <td className="px-3 py-2 text-card-foreground">{row.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.article ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.matchedExisting ? (
                      <span className="rounded-full bg-accent-strong px-2 py-0.5 text-xs font-medium text-accent-foreground">
                        Обновление
                      </span>
                    ) : (
                      <span className="rounded-full bg-success-surface px-2 py-0.5 text-xs font-medium text-success">
                        Создание
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onConfirm(preview.validRows)}
          disabled={isPending || preview.validRows.length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          Подтвердить импорт {preview.validRows.length > 0 ? `(${preview.validRows.length})` : ""}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
        >
          Отменить
        </button>
      </div>
    </div>
  );
}

function ImportResultPanel({ result, onReset }: { result: ImportCommitResult; onReset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-md border border-success-border bg-success-surface p-4">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div className="text-sm text-success">
          <p className="font-medium">Импорт завершён.</p>
          <p>
            Создано: {result.created}. Обновлено: {result.updated}.
            {result.errors.length > 0 && ` Не выполнено: ${result.errors.length}.`}
          </p>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-md border border-danger-border">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-danger-surface text-danger">
              <tr>
                <th className="px-3 py-2 font-medium">Строка</th>
                <th className="px-3 py-2 font-medium">Slug</th>
                <th className="px-3 py-2 font-medium">Ошибка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-danger-surface-hover">
              {result.errors.map((rowError, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-danger">{rowError.rowIndex + 2}</td>
                  <td className="px-3 py-2 text-danger">{rowError.slug}</td>
                  <td className="px-3 py-2 text-danger">{rowError.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={onReset}
        className="self-start rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        Импортировать ещё файл
      </button>
    </div>
  );
}
