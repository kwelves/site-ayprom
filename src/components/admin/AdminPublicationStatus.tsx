"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, TriangleAlert } from "lucide-react";
import { fetchPublicationStatus, retryPublication } from "@/lib/admin/actions";
import type { AdminPublicationStatus as Status } from "@/lib/admin/queries";
import { cn } from "@/lib/utils";

// Tells the owner whether the latest edits are already on the public site. It appears only in the Cloudflare
// admin, where the public site is a published snapshot; elsewhere the status query reports "disabled".
const FAST_POLL_MS = 8_000;
const SLOW_POLL_MS = 30_000;
// A publication normally starts within a minute or two; after this long the badge nudges the worker itself.
const NUDGE_AFTER_MS = 3 * 60_000;

interface AdminPublicationStatusProps {
  /** Short form for the mobile header. */
  compact?: boolean;
}

export function AdminPublicationStatus({ compact = false }: AdminPublicationStatusProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [retrying, setRetrying] = useState(false);
  const waitingSince = useRef<number | null>(null);
  const nudged = useRef(false);

  useEffect(() => {
    // The Cloudflare admin build switches the badge on (vite.admin-spa.config.ts). The Next.js admin never has a
    // published snapshot, and asking the server there would only add a request that page changes then cancel.
    if (process.env.NEXT_PUBLIC_ADMIN_CLOUDFLARE !== "on") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const next = await fetchPublicationStatus();
        if (cancelled) return;
        setStatus(next);
        if (next.enabled && next.state === "pending") {
          waitingSince.current ??= Date.now();
          if (!nudged.current && Date.now() - waitingSince.current > NUDGE_AFTER_MS) {
            nudged.current = true;
            void retryPublication().catch(() => undefined);
          }
        } else {
          waitingSince.current = null;
          nudged.current = false;
        }
        if (!next.enabled) return; // nothing to follow outside the Cloudflare admin
        timer = setTimeout(refresh, next.state === "published" ? SLOW_POLL_MS : FAST_POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(refresh, SLOW_POLL_MS);
      }
    }

    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!status || !status.enabled) return null;

  const label =
    status.state === "published"
      ? "Опубликовано"
      : status.state === "publishing"
        ? "Публикуется…"
        : status.state === "failed"
          ? "Ошибка публикации"
          : "Ожидает публикации";
  const hint =
    status.state === "published"
      ? "Все изменения уже на сайте"
      : status.state === "publishing"
        ? "Сайт обновляется, это занимает несколько минут"
        : status.state === "failed"
          ? "Изменения пока не на сайте"
          : "Сайт обновится автоматически через несколько минут";

  const Icon = status.state === "published" ? CheckCircle2 : status.state === "failed" ? TriangleAlert : Clock3;
  const tone = status.state === "published" ? "text-success" : status.state === "failed" ? "text-danger" : "text-warning";

  if (compact) {
    return (
      <span role="status" title={hint} className={cn("inline-flex items-center gap-1 text-xs font-medium", tone)}>
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </span>
    );
  }

  return (
    <div role="status" data-testid="admin-publication-status" className="shrink-0 border-t border-border px-4 py-3">
      <p className={cn("flex items-center gap-2 text-sm font-medium", tone)}>
        <Icon className={cn("size-4 shrink-0", status.state === "publishing" && "animate-pulse")} aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {status.state === "failed" && (
        <button
          type="button"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void retryPublication()
              .catch(() => undefined)
              .finally(() => setRetrying(false));
          }}
          className="mt-2 rounded-md border border-danger-border px-3 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger-surface disabled:opacity-60"
        >
          {retrying ? "Запуск…" : "Повторить"}
        </button>
      )}
    </div>
  );
}
