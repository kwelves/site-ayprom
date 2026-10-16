"use client";

import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, RotateCw, TriangleAlert } from "lucide-react";
import { fetchPublicationStatus, retryPublication } from "@/lib/admin/actions";
import type { AdminPublicationStatus as Status } from "@/lib/admin/queries";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { EASE_UI } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Tells the owner whether the latest edits are already on the public site. It appears only in the Cloudflare
// admin, where the public site is a published snapshot; elsewhere the status query reports "disabled".
const FAST_POLL_MS = 8_000;
const SLOW_POLL_MS = 30_000;
// A publication normally starts within a minute or two; after this long the badge nudges the worker itself.
const NUDGE_AFTER_MS = 3 * 60_000;

type State = "pending" | "publishing" | "published" | "failed";

const COPY: Record<State, { label: string; hint: string }> = {
  published: { label: "Опубликовано", hint: "Все изменения уже на сайте" },
  publishing: { label: "Публикуется", hint: "Сайт обновляется, это занимает несколько минут" },
  pending: { label: "Ждёт публикации", hint: "Сайт обновится сам через несколько минут" },
  failed: { label: "Ошибка публикации", hint: "Изменения сохранены, но пока не на сайте" },
};

const TONE: Record<State, { text: string; dot: string }> = {
  published: { text: "text-success", dot: "bg-success" },
  publishing: { text: "text-info", dot: "bg-info" },
  pending: { text: "text-warning", dot: "bg-warning" },
  failed: { text: "text-danger", dot: "bg-danger" },
};

// The way an edit travels: saved in the admin, built into the site, live. How far the latest edits are.
const STEPS = ["Сохранено", "Публикуется", "На сайте"] as const;
const REACHED: Record<State, number> = { pending: 1, publishing: 2, published: 3, failed: 1 };

interface AdminPublicationStatusProps {
  /** Short pill for the phone top bar. */
  compact?: boolean;
  /** Sidebar folded to icons: only the dot with the state as its tooltip. */
  collapsed?: boolean;
}

// One poll for the whole admin, however many places show the status (sidebar, phone top bar, phone menu): the
// first shown copy starts it, the last hidden one stops it.
const listeners = new Set<() => void>();
let latest: Status | null = null;
let stopPolling: (() => void) | null = null;

function startPolling() {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitingSince: number | null = null;
  let nudged = false;

  async function refresh() {
    try {
      const next = await fetchPublicationStatus();
      if (cancelled) return;
      latest = next;
      for (const listener of listeners) listener();
      if (next.enabled && next.state === "pending") {
        waitingSince ??= Date.now();
        if (!nudged && Date.now() - waitingSince > NUDGE_AFTER_MS) {
          nudged = true;
          void retryPublication().catch(() => undefined);
        }
      } else {
        waitingSince = null;
        nudged = false;
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
}

function subscribeStatus(onChange: () => void) {
  // The Cloudflare admin build switches the badge on (vite.admin-spa.config.ts). The Next.js admin never has a
  // published snapshot, and asking the server there would only add a request that page changes then cancel.
  if (process.env.NEXT_PUBLIC_ADMIN_CLOUDFLARE !== "on") return () => undefined;
  listeners.add(onChange);
  if (listeners.size === 1) stopPolling = startPolling();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      stopPolling?.();
      stopPolling = null;
    }
  };
}

function usePublicationStatus(): Status | null {
  return useSyncExternalStore(subscribeStatus, () => latest, () => null);
}

export function AdminPublicationStatus({ compact = false, collapsed = false }: AdminPublicationStatusProps) {
  const status = usePublicationStatus();
  const [retrying, setRetrying] = useState(false);
  const reduceMotion = useReducedMotion();

  if (!status || !status.enabled) return null;

  const state: State =
    status.state === "published" || status.state === "publishing" || status.state === "failed" ? status.state : "pending";
  const { label, hint } = COPY[state];
  const tone = TONE[state];
  const swap = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : {
        initial: { opacity: 0, y: 6, filter: "blur(2px)" },
        animate: { opacity: 1, y: 0, filter: "blur(0px)" },
        exit: { opacity: 0, y: -6, filter: "blur(2px)" },
        transition: { duration: 0.2, ease: EASE_UI },
      };

  function retry() {
    setRetrying(true);
    void retryPublication()
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  }

  if (compact || collapsed) {
    return (
      <span
        role="status"
        title={`${label}. ${hint}`}
        aria-label={collapsed ? `${label}. ${hint}` : undefined}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full text-xs font-semibold",
          collapsed ? "w-7 justify-center" : "glass-plate px-2.5",
          tone.text,
        )}
      >
        <StatusDot state={state} className={tone.dot} />
        {!collapsed && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={state} {...swap}>
              {label}
            </motion.span>
          </AnimatePresence>
        )}
      </span>
    );
  }

  const reached = REACHED[state];
  return (
    <div role="status" data-testid="admin-publication-status" className="glass-plate rounded-[14px] p-3">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={state} {...swap}>
          <p className={cn("flex items-center gap-2 text-[13px] font-semibold", tone.text)}>
            <StatusDot state={state} className={tone.dot} />
            {label}
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
        </motion.div>
      </AnimatePresence>

      <ol className="mt-3 grid grid-cols-3 gap-1" aria-label="Путь изменений на сайт">
        {STEPS.map((step, index) => {
          const done = index < reached;
          const current = index === reached - 1 && state !== "published";
          return (
            <li key={step} className="min-w-0">
              <span className="relative block h-1 overflow-hidden rounded-full bg-surface-strong">
                <span
                  className={cn(
                    "absolute inset-0 origin-left rounded-full transition-[scale,background-color] duration-slow ease-ui",
                    done ? "scale-x-100" : "scale-x-0",
                    state === "failed" && index === 1 ? "bg-danger" : tone.dot,
                  )}
                />
                {state === "publishing" && index === 1 && (
                  <span className="absolute inset-y-0 w-1/2 animate-site-loading-progress rounded-full bg-primary-foreground/60" />
                )}
              </span>
              <span
                className={cn(
                  "mt-1.5 block truncate text-[11px]",
                  current ? cn("font-semibold", tone.text) : "text-muted-foreground",
                )}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>

      {state === "failed" && (
        <button
          type="button"
          disabled={retrying}
          onClick={retry}
          className={buttonClassName({ variant: "danger", size: "sm", className: "mt-3 w-full" })}
        >
          <RotateCw aria-hidden="true" className={cn("!size-3.5", retrying && "animate-spin")} />
          {retrying ? "Запускаем…" : "Повторить публикацию"}
        </button>
      )}
    </div>
  );
}

// The dot carries the state: a calm ring breathes while waiting, a check is drawn when the site is live, a
// warning sign on failure. One endless animation at most (the waiting ring).
function StatusDot({ state, className }: { state: State; className: string }) {
  if (state === "published") {
    return (
      <span className={cn("grid size-4 place-items-center rounded-full text-primary-foreground", className)} aria-hidden="true">
        <Check className="!size-2.5 animate-pop-in" strokeWidth={3.5} />
      </span>
    );
  }
  if (state === "failed") return <TriangleAlert aria-hidden="true" className="!size-4" />;
  return (
    <span className="relative grid size-4 place-items-center" aria-hidden="true">
      <span className={cn("absolute size-4 rounded-full opacity-40 animate-attention-pulse", className)} />
      <span className={cn("relative size-2 rounded-full", className)} />
    </span>
  );
}
