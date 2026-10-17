"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, CheckCircle2, Clock3, Loader2, RotateCw, TriangleAlert, X } from "lucide-react";
import { formatRussianCount } from "@/lib/russian-plural";
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

const SURFACE: Record<State, string> = {
  published: "bg-success-surface",
  publishing: "bg-info-surface",
  pending: "bg-warning-surface",
  failed: "bg-danger-surface",
};

interface AdminPublicationStatusProps {
  /** Short pill for the phone top bar. */
  compact?: boolean;
  /** Sidebar folded to icons: only the dot with the state as its tooltip. */
  collapsed?: boolean;
  /** The pill spans the width it is given (sidebar). */
  fill?: boolean;
  /** Where the card opens: under the pill (top bar) or beside it (sidebar). */
  placement?: "below" | "side";
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

export function AdminPublicationStatus({ compact = false, collapsed = false, fill = false, placement = "below" }: AdminPublicationStatusProps) {
  const status = usePublicationStatus();
  const [retrying, setRetrying] = useState(false);
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The top-bar pill opens the full card; a click elsewhere or Esc closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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

  const behind = "behind" in status ? status.behind : 0;
  const steps = stepsFor(state, behind);
  const HeadIcon = state === "published" ? CheckCircle2 : state === "failed" ? TriangleAlert : state === "publishing" ? Loader2 : Clock3;
  const card = (
    <div role="status" data-testid="admin-publication-status" className="rounded-[14px] p-3">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={state} {...swap} className="flex items-start gap-3">
          <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-full", SURFACE[state], tone.text)}>
            <HeadIcon className={cn("size-[18px]", state === "publishing" && "animate-spin")} />
          </span>
          <span className="min-w-0 pt-0.5">
            <span className="block text-[15px] font-semibold tracking-[-0.01em] text-foreground">{label}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{hint}</span>
          </span>
        </motion.div>
      </AnimatePresence>

      <ol className="mt-4" aria-label="Путь изменений на сайт">
        {steps.map((step, index) => (
          <li key={step.title} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 && (
              <span aria-hidden="true" className="absolute top-6 bottom-1 left-[10px] w-0.5 overflow-hidden rounded-full bg-surface-strong">
                <span
                  className={cn(
                    "absolute inset-0 origin-top rounded-full transition-[scale] duration-slow ease-ui",
                    step.state === "done" ? cn("scale-y-100", tone.dot) : "scale-y-0",
                  )}
                />
              </span>
            )}
            <StepNode state={step.state} toneDot={tone.dot} toneText={tone.text} failed={state === "failed"} />
            <span className="min-w-0 pt-px">
              <span className={cn("block text-[13px] font-medium", step.state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>
                {step.title}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{step.note}</span>
            </span>
          </li>
        ))}
      </ol>

      {state === "failed" && (
        <button
          type="button"
          disabled={retrying}
          onClick={retry}
          className={buttonClassName({ variant: "danger", size: "sm", className: "mt-4 w-full" })}
        >
          <RotateCw aria-hidden="true" className={cn("!size-3.5", retrying && "animate-spin")} />
          {retrying ? "Запускаем…" : "Повторить публикацию"}
        </button>
      )}
    </div>
  );
  if (!compact && !collapsed) return card;

  // Top bar: a small pill that is always in sight; the card with the steps and the retry opens under it.
  return (
    // Folded, the 40px button sits on the sidebar's centre line like every other icon; the card still anchors to this root.
    <div ref={rootRef} className={cn("relative", fill && "w-full", collapsed && "flex justify-center")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${label}. ${hint}`}
        className={cn(
          "inline-flex items-center gap-2 text-xs font-semibold transition-[background-color,scale] duration-fast ease-ui active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
          fill
            ? collapsed
              ? "size-10 justify-center rounded-[12px] hover:bg-accent"
              : "h-10 w-full rounded-[12px] px-3 hover:bg-accent"
            : "glass-plate h-9 rounded-full px-3 hover:bg-secondary",
          tone.text,
        )}
      >
        <StatusDot state={state} className={tone.dot} />
        <span role="status" className={cn(!fill && "max-sm:sr-only", collapsed && "sr-only")}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={state} className="block" {...swap}>
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
      {open && (
        <div
          className={cn(
            "glass-float absolute z-40 w-72 animate-[admin-dialog-in_200ms_var(--ease-spring-soft)_backwards] rounded-[18px] p-2",
            placement === "side" ? "bottom-0 left-full ml-3 origin-bottom-left" : "top-full right-0 mt-2 origin-top-right",
          )}
        >
          {card}
        </div>
      )}
    </div>
  );
}

type StepState = "done" | "current" | "failed" | "upcoming";

// The way an edit travels, with what is true at each stop right now.
function stepsFor(state: State, behind: number): { title: string; note: string; state: StepState }[] {
  const queued = behind > 0 ? `${formatRussianCount(behind, ["изменение", "изменения", "изменений"])} в очереди` : "Всё сохранено в каталоге";
  return [
    { title: "Сохранено в админке", note: queued, state: "done" },
    {
      title: "Сборка сайта",
      note:
        state === "published" ? "Готово" : state === "publishing" ? "Идёт сейчас, обычно 2–4 минуты" : state === "failed" ? "Не удалась, изменения целы" : "Начнётся сама через минуту-две",
      state: state === "published" ? "done" : state === "failed" ? "failed" : state === "publishing" ? "current" : "upcoming",
    },
    {
      title: "На сайте",
      note: state === "published" ? "Посетители видят последнюю версию" : "Пока показана прошлая версия",
      state: state === "published" ? "done" : "upcoming",
    },
  ];
}

function StepNode({ state, toneDot, toneText, failed }: { state: StepState; toneDot: string; toneText: string; failed: boolean }) {
  if (state === "done") {
    return (
      <span aria-hidden="true" className={cn("relative z-10 grid size-[22px] shrink-0 place-items-center rounded-full text-primary-foreground", failed ? "bg-success" : toneDot)}>
        <Check className="size-3 animate-pop-in" strokeWidth={3} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span aria-hidden="true" className="relative z-10 grid size-[22px] shrink-0 place-items-center rounded-full bg-danger text-primary-foreground">
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span aria-hidden="true" className={cn("relative z-10 grid size-[22px] shrink-0 place-items-center rounded-full border-2 border-current bg-secondary", toneText)}>
        <span className={cn("absolute size-[22px] rounded-full opacity-30 animate-attention-pulse", toneDot)} />
        <span className={cn("size-2 rounded-full", toneDot)} />
      </span>
    );
  }
  return <span aria-hidden="true" className="relative z-10 size-[22px] shrink-0 rounded-full border-2 border-input bg-secondary" />;
}

// The dot carries the state: a calm ring breathes while waiting, a check is drawn when the site is live, a
// warning sign on failure. One endless animation at most (the waiting ring).
function StatusDot({ state, className }: { state: State; className: string }) {
  if (state === "published") {
    return (
      <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-full text-primary-foreground", className)} aria-hidden="true">
        <Check className="!size-[11px] animate-pop-in" strokeWidth={3.5} />
      </span>
    );
  }
  // All three states occupy the same 18px square as the menu icons, so the column of icons stays one size.
  if (state === "failed") return <TriangleAlert aria-hidden="true" className="!size-[18px] shrink-0" />;
  return (
    <span className="relative grid size-[18px] shrink-0 place-items-center" aria-hidden="true">
      <span className={cn("absolute size-[18px] rounded-full opacity-40 animate-attention-pulse", className)} />
      <span className={cn("relative size-2.5 rounded-full", className)} />
    </span>
  );
}
