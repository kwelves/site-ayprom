"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { previewProductImport, commitProductImport, type ImportCommitResult } from "@/lib/admin/product-import-actions";
import type { ImportPreview } from "@/lib/admin/product-import-parse";
import { useAdminToast } from "@/components/admin/ui/AdminToastProvider";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { cn } from "@/lib/utils";

type Stage = { name: "idle" } | { name: "preview"; preview: ImportPreview; fileName: string } | { name: "done"; result: ImportCommitResult };

const TEMPLATE_COLUMNS = [
  "name",
  "category",
  "short_description",
  "article",
  "subcategory",
  "description",
  "published",
  "brands",
  "vehicle_types",
  "characteristics",
];

const REQUIRED = [
  { column: "name", hint: "название товара" },
  { column: "category", hint: "адрес категории, например hydraulic-pumps" },
  { column: "short_description", hint: "краткое описание" },
];

const OPTIONAL = [
  { column: "article", hint: "артикул: по нему товар обновляется, а не создаётся заново" },
  { column: "subcategory", hint: "адрес подкатегории" },
  { column: "description", hint: "полное описание" },
  { column: "published", hint: "пусто или «да»: опубликован; «нет» или «черновик»: скрыт" },
  { column: "brands", hint: "адреса брендов через «;», например kamaz;man" },
  { column: "vehicle_types", hint: "адреса типов техники через «;»" },
  { column: "characteristics", hint: "Атрибут=Значение через «;»" },
];

const STEPS = ["Файл", "Проверка", "Готово"] as const;

// An empty CSV with the right columns. The byte-order mark makes Excel open Cyrillic as UTF-8; the parser ignores it.
function downloadTemplate() {
  const blob = new Blob([`﻿${TEMPLATE_COLUMNS.join(",")}\r\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ayprom-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function StepBar({ current }: { current: number }) {
  return (
    <ol className="glass-panel mt-5 flex items-center gap-2 rounded-[18px] p-2 text-[13px] font-medium" aria-label="Шаги импорта">
      {STEPS.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={cn(
                "flex h-9 flex-1 items-center gap-2 rounded-[12px] px-3 transition-colors duration-base ease-ui",
                state === "current" && "bg-accent-strong text-accent-foreground",
                state === "done" && "text-success",
                state === "upcoming" && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
                  state === "current" && "bg-primary text-primary-foreground",
                  state === "done" && "bg-success text-primary-foreground",
                  state === "upcoming" && "bg-surface-strong text-muted-foreground",
                )}
              >
                {state === "done" ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : index + 1}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ImportProducts() {
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedFileRef = useRef<File | null>(null);
  const { success } = useAdminToast();

  function readFile(file: File) {
    selectedFileRef.current = file;
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      try {
        const preview = await previewProductImport(formData);
        setStage({ name: "preview", preview, fileName: file.name });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось прочитать файл.");
      }
    });
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) readFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isPending) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setError("Нужен файл в формате CSV. В Excel: «Файл» → «Сохранить как» → «CSV UTF-8».");
      return;
    }
    readFile(file);
  }

  function handleConfirm() {
    const file = selectedFileRef.current;
    if (!file) {
      setError("Выберите CSV-файл заново.");
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      try {
        const result = await commitProductImport(formData);
        setStage({ name: "done", result });
        success(`Импорт завершён: создано ${result.created}, обновлено ${result.updated}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Импорт не выполнен.");
      }
    });
  }

  function handleReset() {
    setStage({ name: "idle" });
    setError(null);
    selectedFileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const step = stage.name === "idle" ? 0 : stage.name === "preview" ? 1 : 2;

  return (
    <>
      <StepBar current={step} />
      <div className="mt-5 flex flex-col gap-5">
        {stage.name === "idle" && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-stretch">
            {/* The glass panel holds a dashed drop area inside it: the dashed edge is what says "drop here". */}
            <div className="glass-panel flex rounded-[18px] p-2">
            <label
              onDragOver={(event) => {
                event.preventDefault();
                if (!isPending) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                "group/drop flex min-h-[280px] flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-input p-8 text-center transition-[border-color,background-color] duration-base ease-ui hover:border-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-primary/30",
                isDragging && "border-primary bg-accent",
                isPending && "cursor-progress",
              )}
            >
              <span
                className={cn(
                  "grid size-14 place-items-center rounded-[16px] bg-accent-strong text-accent-foreground transition-[scale,translate] duration-base ease-spring-soft group-hover/drop:-translate-y-0.5",
                  isDragging && "scale-110",
                )}
              >
                {isPending ? <Loader2 aria-hidden="true" className="size-7 animate-spin" /> : <UploadCloud aria-hidden="true" className="size-7" />}
              </span>
              <span className="text-[15px] font-semibold text-foreground">
                {isPending ? "Читаем файл…" : isDragging ? "Отпустите файл" : "Перетащите CSV-файл сюда"}
              </span>
              <span className="text-sm text-muted-foreground">или</span>
              <span className={buttonClassName({ variant: "primary", size: "lg", className: "pointer-events-none" })}>Выбрать файл</span>
              <span className="mt-1 text-xs text-muted-foreground">В базу ничего не запишется, пока вы не подтвердите.</span>
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

            <section className="glass-panel rounded-[18px] p-5" aria-labelledby="import-columns">
              <div className="flex items-center justify-between gap-3">
                <h2 id="import-columns" className="text-[15px] font-semibold text-foreground">
                  Колонки файла
                </h2>
                <button type="button" onClick={downloadTemplate} className={buttonClassName({ variant: "soft", size: "sm" })}>
                  <Download aria-hidden="true" className="!size-4" />
                  Скачать шаблон
                </button>
              </div>
              <p className="mt-3 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Обязательные</p>
              <ul className="mt-2 space-y-2">
                {REQUIRED.map((item) => (
                  <li key={item.column} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <code className="rounded-[6px] bg-accent-strong px-1.5 py-0.5 font-mono text-[12px] text-accent-foreground">{item.column}</code>
                    <span className="text-muted-foreground">{item.hint}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Необязательные</p>
              <ul className="mt-2 space-y-2">
                {OPTIONAL.map((item) => (
                  <li key={item.column} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <code className="rounded-[6px] bg-surface-strong px-1.5 py-0.5 font-mono text-[12px] text-foreground">{item.column}</code>
                    <span className="text-muted-foreground">{item.hint}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 flex items-start gap-2 rounded-[12px] bg-info-surface px-3 py-2.5 text-[13px] leading-snug text-info">
                <FileSpreadsheet aria-hidden="true" className="mt-px size-4 shrink-0" />
                В Excel сохраняйте как «CSV UTF-8», чтобы русские буквы не превратились в знаки вопроса.
              </p>
            </section>
          </div>
        )}

        {error && (
          <div role="alert" className="flex animate-fade-up items-start gap-2.5 rounded-[14px] border border-danger-border bg-danger-surface p-4 text-sm text-danger">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {stage.name === "preview" && (
          <ImportPreviewPanel
            preview={stage.preview}
            fileName={stage.fileName}
            isPending={isPending}
            onConfirm={handleConfirm}
            onCancel={handleReset}
          />
        )}

        {stage.name === "done" && <ImportResultPanel result={stage.result} onReset={handleReset} />}
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "neutral" | "success" | "info" | "danger" }) {
  return (
    <div
      className={cn(
        "rounded-[14px] px-4 py-3",
        tone === "neutral" && "bg-surface-subtle text-foreground",
        tone === "success" && "bg-success-surface text-success",
        tone === "info" && "bg-accent-strong text-accent-foreground",
        tone === "danger" && "bg-danger-surface text-danger",
      )}
    >
      <p className="text-[24px] leading-none font-semibold tabular-nums">{value}</p>
      <p className="mt-1.5 text-xs font-medium">{label}</p>
    </div>
  );
}

function ImportPreviewPanel({
  preview,
  fileName,
  isPending,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreview;
  fileName?: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const toCreate = preview.validRows.filter((r) => !r.matchedExisting).length;
  const toUpdate = preview.validRows.length - toCreate;

  return (
    <div className="flex animate-fade-up flex-col gap-5">
      <section className="glass-panel rounded-[18px] p-5">
        {fileName && (
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileSpreadsheet aria-hidden="true" className="size-4 text-muted-foreground" />
            {fileName}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="строк в файле" value={preview.totalRows} tone="neutral" />
          <Stat label="будет создано" value={toCreate} tone="success" />
          <Stat label="будет обновлено" value={toUpdate} tone="info" />
          <Stat label="с ошибками" value={preview.errors.length} tone={preview.errors.length > 0 ? "danger" : "neutral"} />
        </div>
      </section>

      {preview.errors.length > 0 && (
        <section className="glass-panel overflow-hidden rounded-[18px]">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-danger">Строки с ошибками не попадут в каталог</h2>
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="sticky top-0 bg-danger-surface text-xs text-danger">
                <tr>
                  <th className="px-5 py-2 font-medium">Строка</th>
                  <th className="px-5 py-2 font-medium">Что не так</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.errors.map((rowError, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2.5 text-danger tabular-nums">{rowError.rowIndex + 2}</td>
                    <td className="px-5 py-2.5 text-foreground">{rowError.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {preview.validRows.length > 0 && (
        <section className="glass-panel overflow-hidden rounded-[18px]">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">Что будет записано</h2>
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="sticky top-0 bg-surface-subtle text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">Строка</th>
                  <th className="px-5 py-2 font-medium">Название</th>
                  <th className="px-5 py-2 font-medium">Артикул</th>
                  <th className="px-5 py-2 font-medium">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.validRows.map((row) => (
                  <tr key={row.rowIndex} className="transition-colors duration-fast ease-ui hover:bg-accent/40">
                    <td className="px-5 py-2.5 text-muted-foreground tabular-nums">{row.rowIndex + 2}</td>
                    <td className="px-5 py-2.5 font-medium text-foreground">{row.name}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{row.article ?? "Нет"}</td>
                    <td className="px-5 py-2.5">
                      {row.matchedExisting ? (
                        <span className="rounded-full bg-accent-strong px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">Обновление</span>
                      ) : (
                        <span className="rounded-full bg-success-surface px-2.5 py-0.5 text-xs font-semibold text-success">Создание</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="glass-float sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-[18px] px-3 py-2.5 sm:gap-3 sm:px-4">
        <p className="mr-auto text-sm text-muted-foreground">
          {preview.validRows.length > 0
            ? "Проверьте список. После подтверждения товары запишутся в каталог."
            : "В файле нет строк, которые можно записать. Исправьте ошибки и загрузите файл снова."}
        </p>
        <button type="button" onClick={onCancel} disabled={isPending} className={buttonClassName({ variant: "glass" })}>
          Другой файл
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending || preview.validRows.length === 0}
          className={buttonClassName({ variant: "primary" })}
        >
          {isPending && <Loader2 aria-hidden="true" className="animate-spin" />}
          Записать {preview.validRows.length > 0 ? `${preview.validRows.length}` : ""} в каталог
        </button>
      </div>
    </div>
  );
}

function ImportResultPanel({ result, onReset }: { result: ImportCommitResult; onReset: () => void }) {
  return (
    <div className="flex animate-fade-up flex-col gap-5">
      <section className="glass-panel flex flex-col items-start gap-4 rounded-[18px] p-6 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success-surface text-success">
          <CheckCircle2 aria-hidden="true" className="size-6 animate-pop-in" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-foreground">Импорт завершён</p>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            Создано: {result.created}. Обновлено: {result.updated}.
            {result.errors.length > 0 && ` Не выполнено: ${result.errors.length}.`}
          </p>
        </div>
        <button type="button" onClick={onReset} className={buttonClassName({ variant: "glass" })}>
          Импортировать ещё файл
        </button>
      </section>

      {result.errors.length > 0 && (
        <section className="glass-panel overflow-hidden rounded-[18px]">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-danger">Не выполнено</h2>
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="sticky top-0 bg-danger-surface text-xs text-danger">
                <tr>
                  <th className="px-5 py-2 font-medium">Строка</th>
                  <th className="px-5 py-2 font-medium">Адрес</th>
                  <th className="px-5 py-2 font-medium">Что не так</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.errors.map((rowError, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2.5 text-danger tabular-nums">{rowError.rowIndex + 2}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{rowError.slug}</td>
                    <td className="px-5 py-2.5 text-foreground">{rowError.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
