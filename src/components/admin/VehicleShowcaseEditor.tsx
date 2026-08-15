"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { RotateCcw, Search, X } from "lucide-react";
import { restoreVehicleHotspots, saveVehicleHotspots, searchAvailableHotspotProducts } from "@/lib/admin/actions";
import type { VehicleHotspotActionState, VehicleHotspotUpdate } from "@/lib/admin/vehicle-hotspot-updates";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { AdminUndoToast } from "@/components/admin/ui/AdminUndoToast";
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

type EditorConfirmation =
  | { kind: "discard" }
  | { kind: "undo"; snapshot: EditableHotspot[]; expectedSavedUpdates: VehicleHotspotUpdate[] }
  | null;

interface UndoToastState {
  id: number;
  message: string;
  snapshot: EditableHotspot[] | null;
  expectedSavedUpdates: VehicleHotspotUpdate[] | null;
}

function toEditableHotspots(hotspots: AdminVehicleHotspot[]): EditableHotspot[] {
  return hotspots.map((hotspot) => ({
    id: hotspot.id,
    hotspotNumber: hotspot.hotspotNumber,
    label: hotspot.label,
    product: hotspot.product,
  }));
}

function copyHotspots(hotspots: EditableHotspot[]): EditableHotspot[] {
  return hotspots.map((hotspot) => ({
    ...hotspot,
    product: hotspot.product ? { ...hotspot.product } : null,
  }));
}

function hotspotsMatch(first: EditableHotspot[], second: EditableHotspot[]): boolean {
  return (
    first.length === second.length &&
    first.every(
      (hotspot, index) =>
        hotspot.id === second[index]?.id &&
        hotspot.label === second[index]?.label &&
        hotspot.product?.id === second[index]?.product?.id,
    )
  );
}

export function VehicleShowcaseEditor({ vehicleTypeSlug, vehicleTypeName, hotspots: initialHotspots }: VehicleShowcaseEditorProps) {
  const [hotspots, setHotspots] = useState<EditableHotspot[]>(() => toEditableHotspots(initialHotspots));
  const [savedHotspots, setSavedHotspots] = useState<EditableHotspot[]>(() => toEditableHotspots(initialHotspots));
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, AdminAvailableProduct[]>>({});
  const [removedProducts, setRemovedProducts] = useState<Record<string, AdminAvailableProduct>>({});
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dismissedFormError, setDismissedFormError] = useState<VehicleHotspotActionState>(null);
  const [confirmation, setConfirmation] = useState<EditorConfirmation>(null);
  const [undoToast, setUndoToast] = useState<UndoToastState | null>(null);
  const searchRequest = useRef<Record<string, number>>({});
  const pendingSaveSnapshot = useRef<EditableHotspot[] | null>(null);
  const handledSaveState = useRef<VehicleHotspotActionState>(null);
  const toastId = useRef(0);
  const confirmationDialogRef = useRef<HTMLDivElement>(null);
  const confirmationCancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationTriggerRef = useRef<HTMLElement | null>(null);
  const [, startSearchTransition] = useTransition();
  const [isUndoPending, startUndoTransition] = useTransition();
  const boundAction = saveVehicleHotspots.bind(null, vehicleTypeSlug);
  const [formState, formAction, isSavePending] = useActionState(boundAction, null);
  const formError = formState && "error" in formState ? formState.error : null;
  const formSucceeded = Boolean(formState && "success" in formState && formState.success);
  const displayedError = searchError ?? (formState !== dismissedFormError ? (formError ?? null) : null);
  const hasUnsavedChanges = !hotspotsMatch(hotspots, savedHotspots);
  const isEditorMutationPending = isSavePending || isUndoPending;

  const dismissUndoToast = useCallback(() => setUndoToast(null), []);

  useEffect(() => {
    if (confirmation) confirmationCancelButtonRef.current?.focus();
  }, [confirmation]);

  const clearLocalEditorState = useCallback(() => {
    setQueries({});
    setResults({});
    setRemovedProducts({});
    setSearchError(null);
    setDismissedFormError(formState);
  }, [formState]);

  function updateHotspot(id: string, changes: Partial<Pick<EditableHotspot, "label" | "product">>) {
    if (isEditorMutationPending) return;
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
    if (isEditorMutationPending) return;
    setQueries((current) => ({ ...current, [hotspot.id]: query }));
    setSearchError(null);
    searchRequest.current[hotspot.id] = (searchRequest.current[hotspot.id] ?? 0) + 1;

    if (query.trim().length < 2) {
      setResults((current) => ({ ...current, [hotspot.id]: [] }));
    }
  }

  function chooseProduct(hotspot: EditableHotspot, product: AdminAvailableProduct) {
    if (isEditorMutationPending) return;
    const usedElsewhere = hotspots.some((item) => item.id !== hotspot.id && item.product?.id === product.id);
    if (usedElsewhere) {
      setSearchError(`Товар «${product.name}» уже выбран для другой точки.`);
      return;
    }

    updateHotspot(hotspot.id, { product });
    setRemovedProducts((current) => {
      const remaining = { ...current };
      delete remaining[hotspot.id];
      return remaining;
    });
    setQueries((current) => ({ ...current, [hotspot.id]: "" }));
    setResults((current) => ({ ...current, [hotspot.id]: [] }));
  }

  function removeProduct(hotspot: EditableHotspot) {
    if (isEditorMutationPending || !hotspot.product) return;
    setRemovedProducts((current) => ({ ...current, [hotspot.id]: hotspot.product! }));
    updateHotspot(hotspot.id, { product: null });
  }

  function restoreRemovedProduct(hotspot: EditableHotspot) {
    if (isEditorMutationPending) return;
    const product = removedProducts[hotspot.id];
    if (!product) return;

    const usedElsewhere = hotspots.some((item) => item.id !== hotspot.id && item.product?.id === product.id);
    if (usedElsewhere) {
      setSearchError(`Товар «${product.name}» уже выбран для другой точки.`);
      return;
    }

    updateHotspot(hotspot.id, { product });
    setRemovedProducts((current) => {
      const remaining = { ...current };
      delete remaining[hotspot.id];
      return remaining;
    });
  }

  function resetToSavedHotspots() {
    if (isEditorMutationPending) return;
    setHotspots(copyHotspots(savedHotspots));
    clearLocalEditorState();
  }

  function requestDiscardChanges() {
    if (isEditorMutationPending || !hasUnsavedChanges) return;
    openConfirmation({ kind: "discard" });
  }

  function saveSnapshotBeforeSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (isEditorMutationPending) {
      event.preventDefault();
      return;
    }
    pendingSaveSnapshot.current = copyHotspots(hotspots);
  }

  function openConfirmation(nextConfirmation: Exclude<EditorConfirmation, null>) {
    confirmationTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation(nextConfirmation);
  }

  function closeConfirmation() {
    setConfirmation(null);
    requestAnimationFrame(() => confirmationTriggerRef.current?.focus());
  }

  function handleConfirmationKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key !== "Tab") return;

    const buttons = confirmationDialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    if (!buttons || buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const payload = hotspots.map((hotspot) => ({
    id: hotspot.id,
    label: hotspot.label,
    productId: hotspot.product?.id ?? null,
  }));

  useEffect(() => {
    if (!formSucceeded || handledSaveState.current === formState) return;
    handledSaveState.current = formState;

    const previousSnapshot = copyHotspots(savedHotspots);
    const submittedSnapshot = pendingSaveSnapshot.current ?? copyHotspots(hotspots);
    const savedUpdates = formState && "savedUpdates" in formState ? (formState.savedUpdates ?? []) : [];
    const successfulSnapshot = submittedSnapshot.map((hotspot) => {
      const savedUpdate = savedUpdates.find((update) => update.id === hotspot.id);
      return savedUpdate ? { ...hotspot, label: savedUpdate.label } : hotspot;
    });
    pendingSaveSnapshot.current = null;
    setSavedHotspots(successfulSnapshot);
    setHotspots(successfulSnapshot);
    clearLocalEditorState();
    setUndoToast({
      id: ++toastId.current,
      message: "Изменения сохранены.",
      snapshot: previousSnapshot,
      expectedSavedUpdates: savedUpdates.map((update) => ({ ...update })),
    });
  }, [clearLocalEditorState, formState, formSucceeded, hotspots, savedHotspots]);

  function performUndoSavedChanges(snapshot: EditableHotspot[], expectedSavedUpdates: VehicleHotspotUpdate[]) {
    if (isEditorMutationPending) return;

    startUndoTransition(async () => {
      try {
        const result = await restoreVehicleHotspots(
          vehicleTypeSlug,
          snapshot.map((hotspot) => ({ id: hotspot.id, label: hotspot.label, productId: hotspot.product?.id ?? null })),
          expectedSavedUpdates,
        );
        if (result?.error) {
          setSearchError(result.error);
          return;
        }

        const restoredSnapshot = copyHotspots(snapshot);
        setHotspots(restoredSnapshot);
        setSavedHotspots(restoredSnapshot);
        clearLocalEditorState();
        setUndoToast({ id: ++toastId.current, message: "Изменения отменены.", snapshot: null, expectedSavedUpdates: null });
      } catch {
        setSearchError("Не удалось отменить сохранённые изменения. Попробуйте ещё раз.");
      }
    });
  }

  function requestUndoSavedChanges() {
    const snapshot = undoToast?.snapshot;
    const expectedSavedUpdates = undoToast?.expectedSavedUpdates;
    if (isEditorMutationPending || !snapshot || !expectedSavedUpdates) return;
    if (hasUnsavedChanges) {
      openConfirmation({
        kind: "undo",
        snapshot: copyHotspots(snapshot),
        expectedSavedUpdates: expectedSavedUpdates.map((update) => ({ ...update })),
      });
      return;
    }
    performUndoSavedChanges(snapshot, expectedSavedUpdates);
  }

  function confirmAction() {
    if (!confirmation) return;
    if (confirmation.kind === "discard") {
      resetToSavedHotspots();
      closeConfirmation();
      return;
    }

    const snapshot = confirmation.snapshot;
    closeConfirmation();
    performUndoSavedChanges(snapshot, confirmation.expectedSavedUpdates);
  }

  const isUndoConfirmation = confirmation?.kind === "undo";
  return (
    <form action={formAction} onSubmit={saveSnapshotBeforeSubmit} className="mt-6 space-y-4">
      <input type="hidden" name="hotspots" value={JSON.stringify(payload)} />
      <fieldset disabled={isEditorMutationPending} className="contents">

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
              disabled={isSavePending}
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
                  disabled={isSavePending}
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
                          disabled={selectedElsewhere || isSavePending}
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
                    onClick={() => removeProduct(hotspot)}
                    disabled={isSavePending}
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-danger transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                    Снять товар
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-sm text-muted-foreground">Товар не закреплён — на сайте будет показана заглушка.</p>
                  {removedProducts[hotspot.id] && (
                    <button
                      type="button"
                      onClick={() => restoreRemovedProduct(hotspot)}
                      disabled={isSavePending}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <RotateCcw aria-hidden="true" className="h-4 w-4" />
                      Вернуть товар
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        );
        })}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <SubmitButton pendingLabel="Сохранение…">Сохранить изменения</SubmitButton>
        <button
          type="button"
          onClick={requestDiscardChanges}
          disabled={!hasUnsavedChanges || isEditorMutationPending}
          className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-medium text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Отменить изменения
        </button>
        </div>
      </fieldset>
      {confirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
          <div
            ref={confirmationDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="vehicle-showcase-confirmation-title"
            aria-describedby="vehicle-showcase-confirmation-description"
            onKeyDown={handleConfirmationKeyDown}
            className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg"
          >
            <h2 id="vehicle-showcase-confirmation-title" className="text-base font-semibold text-card-foreground">
              {isUndoConfirmation ? "Отменить сохранённые изменения?" : "Отменить несохранённые изменения?"}
            </h2>
            <p id="vehicle-showcase-confirmation-description" className="mt-2 text-sm text-muted-foreground">
              {isUndoConfirmation
                ? "Несохранённые правки будут отменены, а хотспоты вернутся к состоянию до последнего сохранения."
                : "Все изменения названий и закреплённых товаров будут возвращены к последнему сохранённому состоянию."}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                ref={confirmationCancelButtonRef}
                type="button"
                onClick={closeConfirmation}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Продолжить редактирование
              </button>
              <button
                type="button"
                onClick={confirmAction}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                {isUndoConfirmation ? "Отменить сохранение" : "Отменить изменения"}
              </button>
            </div>
          </div>
        </div>
      )}
      <AdminActionFeedback
        message={displayedError}
        onDismiss={() => {
          setSearchError(null);
          setDismissedFormError(formState);
        }}
      />
      <AdminUndoToast
        toast={undoToast}
        actionLabel={undoToast?.snapshot && undoToast.expectedSavedUpdates && !isEditorMutationPending ? "Отменить" : undefined}
        pending={isUndoPending}
        onAction={requestUndoSavedChanges}
        onDismiss={dismissUndoToast}
      />
    </form>
  );
}
