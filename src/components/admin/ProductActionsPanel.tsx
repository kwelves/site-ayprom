"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, Copy, Loader2, MoreHorizontal, Pin, Unlink, X } from "lucide-react";
import { VehicleHotspotPreview } from "@/components/admin/VehicleHotspotPreview";
import { cn } from "@/lib/utils";
import type { AdminProductHotspotOption, AdminProductListItem } from "@/lib/admin/queries";

interface ProductActionsPanelProps {
  open: boolean;
  product: AdminProductListItem | null;
  hotspots: AdminProductHotspotOption[];
  pending: boolean;
  onClose: () => void;
  onAssign: (hotspot: AdminProductHotspotOption) => void;
  onDetach: (hotspot: AdminProductHotspotOption) => void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function ProductActionsPanel({
  open,
  product,
  hotspots,
  pending,
  onClose,
  onAssign,
  onDetach,
}: ProductActionsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const assignmentButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previousViewRef = useRef<"actions" | "picker">("actions");
  const titleId = useId();
  const productAssignments = useMemo(
    () =>
      hotspots
        .filter((hotspot) => hotspot.product?.id === product?.id)
        .sort(
          (left, right) =>
            left.vehicleTypeOrder - right.vehicleTypeOrder ||
            left.hotspotNumber - right.hotspotNumber ||
            left.id.localeCompare(right.id),
        ),
    [hotspots, product?.id],
  );
  const assignmentGroups = useMemo(() => {
    const groups = new Map<string, { name: string; hotspots: AdminProductHotspotOption[] }>();
    for (const hotspot of productAssignments) {
      const group = groups.get(hotspot.vehicleTypeSlug) ?? { name: hotspot.vehicleTypeName, hotspots: [] };
      group.hotspots.push(hotspot);
      groups.set(hotspot.vehicleTypeSlug, group);
    }
    return [...groups.entries()].map(([slug, group]) => ({ slug, ...group }));
  }, [productAssignments]);
  const [view, setView] = useState<"actions" | "picker">("actions");
  const [selectedVehicleSlug, setSelectedVehicleSlug] = useState(
    () => productAssignments[0]?.vehicleTypeSlug ?? hotspots[0]?.vehicleTypeSlug ?? "",
  );
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const vehicleTypes = useMemo(() => {
    const bySlug = new Map<string, { slug: string; name: string; order: number }>();
    for (const hotspot of hotspots) {
      bySlug.set(hotspot.vehicleTypeSlug, {
        slug: hotspot.vehicleTypeSlug,
        name: hotspot.vehicleTypeName,
        order: hotspot.vehicleTypeOrder,
      });
    }
    return [...bySlug.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
  }, [hotspots]);

  const selectedVehicle =
    vehicleTypes.find((vehicleType) => vehicleType.slug === selectedVehicleSlug) ?? vehicleTypes[0] ?? null;
  const selectedVehicleHotspots = selectedVehicle
    ? hotspots
        .filter((hotspot) => hotspot.vehicleTypeSlug === selectedVehicle.slug)
        .sort((a, b) => a.hotspotNumber - b.hotspotNumber)
    : [];
  const selectedHotspot = hotspots.find((hotspot) => hotspot.id === selectedHotspotId) ?? null;
  const isCurrentHotspot = selectedHotspot?.product?.id === product?.id;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      const trigger = previousFocusRef.current;
      if (trigger?.isConnected) trigger.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || previousViewRef.current === view) return;
    if (view === "picker") {
      backButtonRef.current?.focus();
    } else if (assignmentButtonRef.current && !assignmentButtonRef.current.disabled) {
      assignmentButtonRef.current.focus();
    } else {
      headingRef.current?.focus();
    }
    previousViewRef.current = view;
  }, [open, view]);

  useEffect(() => {
    if (!open || !pending || panelRef.current?.contains(document.activeElement)) return;
    headingRef.current?.focus();
  }, [open, pending, product?.hotspotCount]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    if (focusableElements.length === 0) return;
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function copyArticle() {
    if (!product?.article) return;
    try {
      await navigator.clipboard.writeText(product.article);
      setCopyStatus("Артикул скопирован");
    } catch {
      setCopyStatus("Не удалось скопировать артикул");
    }
  }

  if (!open || !product) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-foreground/40 md:items-stretch md:justify-end"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border bg-card shadow-lg animate-fade-up",
          "motion-reduce:animate-none md:h-full md:max-h-none md:max-w-md md:rounded-none md:border-l md:border-t-0 md:animate-slide-in-right",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="shrink-0 border-b border-border px-4 pb-3 pt-2 md:px-5 md:pt-4">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border md:hidden" aria-hidden="true" />
          <div className="flex min-h-11 items-center gap-2">
            {view === "picker" && (
              <button
                ref={backButtonRef}
                type="button"
                onClick={() => {
                  setView("actions");
                  setSelectedHotspotId(null);
                }}
                aria-label="Вернуться к быстрым действиям"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h2
                ref={headingRef}
                id={titleId}
                tabIndex={-1}
                className="truncate text-base font-semibold text-card-foreground focus:outline-none"
              >
                {view === "picker" ? "Выбрать хотспот" : "Действия с товаром"}
              </h2>
              <p className="truncate text-sm text-muted-foreground">{product.name}</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Закрыть действия с товаром"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5">
          {view === "actions" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Использование в спецтехнике</p>
                {assignmentGroups.length > 0 ? (
                  <div className="mt-2 space-y-3">
                    <p className="text-sm font-medium text-card-foreground">
                      Используется в {productAssignments.length} {productAssignments.length === 1 ? "хотспоте" : "хотспотах"}
                    </p>
                    {assignmentGroups.map((group) => (
                      <div key={group.slug}>
                        <p className="text-sm font-medium text-card-foreground">{group.name}</p>
                        <ul className="mt-1 space-y-1.5">
                          {group.hotspots.map((hotspot) => (
                            <li key={hotspot.id} className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-card px-3 py-1.5">
                              <span className="min-w-0 text-sm text-muted-foreground">
                                <span className="font-medium text-card-foreground">Точка №{hotspot.hotspotNumber}</span>
                                <span className="block truncate text-xs">{hotspot.label}</span>
                              </span>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => onDetach(hotspot)}
                                aria-label={`Снять с хотспота «${hotspot.label}» техники «${hotspot.vehicleTypeName}»`}
                                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-danger transition-colors hover:bg-danger-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Unlink className="h-4 w-4" aria-hidden="true" />}
                                Снять
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Товар пока не закреплён за техникой.</p>
                )}
              </div>

              <div className="grid gap-2">
                <button
                  ref={assignmentButtonRef}
                  type="button"
                  disabled={!product.published || hotspots.length === 0 || pending}
                  onClick={() => setView("picker")}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left text-sm font-medium text-card-foreground transition-colors hover:border-border-interactive hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Pin className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  {productAssignments.length > 0 ? "Добавить ещё один хотспот" : "Закрепить за хотспотом"}
                </button>
                {!product.published && (
                  <p className="px-1 text-xs text-warning">Сначала опубликуйте товар.</p>
                )}
                {product.published && hotspots.length === 0 && (
                  <p className="px-1 text-xs text-muted-foreground">Настроенных хотспотов пока нет.</p>
                )}
                {product.article && (
                  <button
                    type="button"
                    onClick={copyArticle}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left text-sm font-medium text-card-foreground transition-colors hover:border-border-interactive hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Copy className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    Скопировать артикул
                  </button>
                )}
                <p role="status" aria-live="polite" className="min-h-5 px-1 text-xs text-muted-foreground">
                  {copyStatus}
                </p>
              </div>
            </div>
          ) : selectedVehicle ? (
            <div className="space-y-4">
              <nav aria-label="Выбор типа техники" className="flex gap-2 overflow-x-auto pb-1">
                {vehicleTypes.map((vehicleType) => (
                  <button
                    key={vehicleType.slug}
                    type="button"
                    aria-current={vehicleType.slug === selectedVehicle.slug ? "true" : undefined}
                    onClick={() => {
                      setSelectedVehicleSlug(vehicleType.slug);
                      setSelectedHotspotId(null);
                    }}
                    className={cn(
                      "min-h-11 shrink-0 rounded-xl px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      vehicleType.slug === selectedVehicle.slug
                        ? "bg-primary text-primary-foreground"
                        : "border border-border text-muted-foreground hover:bg-accent hover:text-card-foreground",
                    )}
                  >
                    {vehicleType.name}
                  </button>
                ))}
              </nav>

              <VehicleHotspotPreview
                key={selectedVehicle.slug}
                vehicleTypeSlug={selectedVehicle.slug}
                hotspots={selectedVehicleHotspots}
              />

              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-semibold text-card-foreground">Точки на технике</legend>
                {selectedVehicleHotspots.map((hotspot) => {
                  const current = hotspot.product?.id === product.id;
                  const selected = hotspot.id === selectedHotspotId;
                  return (
                    <button
                      key={hotspot.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={pending || current}
                      onClick={() => setSelectedHotspotId(hotspot.id)}
                      className={cn(
                        "grid min-h-11 w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default",
                        selected ? "border-primary bg-accent" : "border-border hover:border-border-interactive hover:bg-accent/60",
                        current && "bg-muted/40 opacity-70",
                      )}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                        {hotspot.hotspotNumber}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-card-foreground">{hotspot.label}</span>
                        <span className={cn("block truncate text-xs", hotspot.product && !current ? "text-warning" : "text-muted-foreground")}>
                          {current ? "Уже используется этим товаром" : hotspot.product ? `Занят: ${hotspot.product.name}` : "Свободно"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </fieldset>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Настроенных хотспотов пока нет.</p>
          )}
        </div>

        {view === "picker" && selectedHotspot && !isCurrentHotspot && (
          <div className="shrink-0 border-t border-border bg-card px-4 py-3 md:px-5">
            {selectedHotspot.product && (
              <p className="mb-2 text-xs leading-snug text-warning">
                Точка занята товаром «{selectedHotspot.product.name}». После подтверждения он будет снят с этой точки.
              </p>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => onAssign(selectedHotspot)}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {selectedHotspot.product ? "Заменить товар" : "Закрепить"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProductActionsButton({ product, onOpen }: { product: AdminProductListItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Открыть действия с товаром «${product.name}»`}
      aria-haspopup="dialog"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:bg-accent"
    >
      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
