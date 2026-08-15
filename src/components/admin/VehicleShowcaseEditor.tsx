"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { saveVehicleHotspots, searchAvailableHotspotProducts } from "@/lib/admin/actions";
import type { FormActionState } from "@/lib/admin/actions";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { Input } from "@/components/admin/ui/Input";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import type { AdminAvailableProduct, AdminVehicleHotspot } from "@/lib/admin/queries";

interface VehicleShowcaseEditorProps {
  vehicleTypeSlug: string;
  vehicleTypeName: string;
  hotspots: AdminVehicleHotspot[];
}

interface EditableHotspot {
  id: string;
  hotspotNumber: number;
  label: string;
  product: AdminAvailableProduct | null;
}

function toEditableHotspots(hotspots: AdminVehicleHotspot[]): EditableHotspot[] {
  return hotspots.map((hotspot) => ({
    id: hotspot.id,
    hotspotNumber: hotspot.hotspotNumber,
    label: hotspot.label,
    product: hotspot.product,
  }));
}

export function VehicleShowcaseEditor({ vehicleTypeSlug, vehicleTypeName, hotspots: initialHotspots }: VehicleShowcaseEditorProps) {
  const [hotspots, setHotspots] = useState<EditableHotspot[]>(() => toEditableHotspots(initialHotspots));
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, AdminAvailableProduct[]>>({});
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dismissedFormError, setDismissedFormError] = useState<FormActionState>(null);
  const searchRequest = useRef<Record<string, number>>({});
  const [, startSearchTransition] = useTransition();
  const boundAction = saveVehicleHotspots.bind(null, vehicleTypeSlug);
  const [formState, formAction] = useActionState(boundAction, null);
  const displayedError = searchError ?? (formState !== dismissedFormError ? (formState?.error ?? null) : null);

  function updateHotspot(id: string, changes: Partial<Pick<EditableHotspot, "label" | "product">>) {
    setHotspots((current) => current.map((hotspot) => (hotspot.id === id ? { ...hotspot, ...changes } : hotspot)));
  }

  useEffect(() => {
    const timers: number[] = [];

    for (const [hotspotId, query] of Object.entries(queries)) {
      const trimmedQuery = query.trim();
      if (trimmedQuery.length < 2) continue;

      const requestId = (searchRequest.current[hotspotId] ?? 0) + 1;
      searchRequest.current[hotspotId] = requestId;
      timers.push(
        window.setTimeout(() => {
          startSearchTransition(async () => {
            try {
              const products = await searchAvailableHotspotProducts(trimmedQuery, hotspotId);
              if (searchRequest.current[hotspotId] === requestId) {
                setResults((current) => ({ ...current, [hotspotId]: products }));
              }
            } catch {
              if (searchRequest.current[hotspotId] === requestId) {
                setSearchError("Не удалось найти товары. Попробуйте ещё раз.");
              }
            }
          });
        }, 300),
      );
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [queries, startSearchTransition]);

  function handleSearchChange(hotspot: EditableHotspot, query: string) {
    setQueries((current) => ({ ...current, [hotspot.id]: query }));
    setSearchError(null);
    searchRequest.current[hotspot.id] = (searchRequest.current[hotspot.id] ?? 0) + 1;

    if (query.trim().length < 2) {
      setResults((current) => ({ ...current, [hotspot.id]: [] }));
    }
  }

  function chooseProduct(hotspot: EditableHotspot, product: AdminAvailableProduct) {
    const usedElsewhere = hotspots.some((item) => item.id !== hotspot.id && item.product?.id === product.id);
    if (usedElsewhere) {
      setSearchError(`Товар «${product.name}» уже выбран для другой точки.`);
      return;
    }

    updateHotspot(hotspot.id, { product });
    setQueries((current) => ({ ...current, [hotspot.id]: "" }));
    setResults((current) => ({ ...current, [hotspot.id]: [] }));
  }

  const payload = hotspots.map((hotspot) => ({
    id: hotspot.id,
    label: hotspot.label,
    productId: hotspot.product?.id ?? null,
  }));

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="hotspots" value={JSON.stringify(payload)} />

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-card-foreground">{vehicleTypeName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Настройка пяти точек на технике.</p>
      </div>

      {hotspots.map((hotspot) => {
        const foundProducts = results[hotspot.id] ?? [];
        const query = queries[hotspot.id] ?? "";
        const inputId = `hotspot-${hotspot.id}-label`;
        const searchId = `hotspot-${hotspot.id}-search`;

        return (
          <section key={hotspot.id} className="rounded-lg border border-border bg-card p-4" aria-labelledby={`hotspot-${hotspot.id}-heading`}>
            <div className="flex items-center justify-between gap-3">
              <h3 id={`hotspot-${hotspot.id}-heading`} className="text-sm font-semibold text-card-foreground">
                Точка {hotspot.hotspotNumber}
              </h3>
              <span className="text-xs text-muted-foreground">№ {hotspot.hotspotNumber}</span>
            </div>

            <label htmlFor={inputId} className="mt-4 block text-sm font-medium text-card-foreground">
              Название хотспота
            </label>
            <Input
              id={inputId}
              value={hotspot.label}
              required
              onChange={(event) => updateHotspot(hotspot.id, { label: event.target.value })}
            />

            <div className="mt-4">
              <label htmlFor={searchId} className="block text-sm font-medium text-card-foreground">
                Закреплённый товар
              </label>
              <div className="relative mt-1.5">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={searchId}
                  value={query}
                  onChange={(event) => handleSearchChange(hotspot, event.target.value)}
                  placeholder="Введите название или артикул"
                  autoComplete="off"
                  className="pl-9"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Введите минимум 2 символа. В поиске доступны только опубликованные и незакреплённые товары.
              </p>

              {query.trim().length >= 2 && (
                <div className="mt-2 overflow-hidden rounded-md border border-border" aria-live="polite">
                  {foundProducts.length > 0 ? (
                    foundProducts.map((product) => {
                      const selectedElsewhere = hotspots.some((item) => item.id !== hotspot.id && item.product?.id === product.id);
                      return (
                        <button
                          key={product.id}
                          type="button"
                          aria-label={`Выбрать товар «${product.name}» для точки ${hotspot.hotspotNumber}`}
                          disabled={selectedElsewhere}
                          onClick={() => chooseProduct(hotspot, product)}
                          className="block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="block text-sm font-medium text-card-foreground">{product.name}</span>
                          {product.article && <span className="mt-0.5 block text-xs text-muted-foreground">Артикул: {product.article}</span>}
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Подходящие товары не найдены.</p>
                  )}
                </div>
              )}

              {hotspot.product ? (
                <div className="mt-3 flex items-start justify-between gap-3 rounded-md bg-accent px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-card-foreground">{hotspot.product.name}</p>
                    {hotspot.product.article && <p className="mt-0.5 text-xs text-muted-foreground">Артикул: {hotspot.product.article}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => updateHotspot(hotspot.id, { product: null })}
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-danger transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                    Снять товар
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Товар не закреплён — на сайте будет показана заглушка.</p>
              )}
            </div>
          </section>
        );
      })}

      <div className="flex items-center border-t border-border pt-6">
        <SubmitButton pendingLabel="Сохранение…">Сохранить изменения</SubmitButton>
      </div>
      <AdminActionFeedback
        message={displayedError}
        onDismiss={() => {
          setSearchError(null);
          setDismissedFormError(formState);
        }}
      />
    </form>
  );
}
