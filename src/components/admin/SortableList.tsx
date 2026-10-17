"use client";

import { useEffect, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableListProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (newItems: T[]) => void;
  renderItem: (item: T) => React.ReactNode;
  className?: string;
  // When true, always render the static (non-draggable) list below instead of
  // mounting DndContext — for filtered/searched views where the visible
  // subset's order doesn't correspond to the full list's real order.
  disabled?: boolean;
  // Identifies rows for the post-save scroll/highlight flash (useSaveFlowFlash)
  // independently of getId — needed where getId isn't the same key the save
  // flow addresses an item by (e.g. subcategories are dragged by `id` but
  // flashed by `slug`, since that's what the redirecting Server Action knows
  // without an extra lookup). Defaults to getId when the two coincide.
  getFlashKey?: (item: T) => string;
  highlightedKey?: string | null;
  // Adds ▲▼ buttons next to the drag handle, visible only below the `md`
  // breakpoint — a guaranteed-reachable reorder path on touch, since drag
  // itself works via PointerSensor but has no visible affordance on a
  // screen with no hover state. Reuses the exact same onReorder(arrayMove(...))
  // call as a drag, so there is no separate reorder code path to keep in sync.
  enableStepButtons?: boolean;
  /** "panel" (default): the rows sit in one glass panel, like a table. "inset": the list already lives inside a
   * panel (photos, characteristics), so each row is a light plate instead of a second glass layer. */
  surface?: Surface;
}

/** "grid": few, picture-led items (categories) as cards in a grid; dragging works across rows and columns. */
type Surface = "panel" | "inset" | "grid" | "tiles";

// Rows of the working place (design system v2, "Таблица"): blue 8% on hover, 14% for the row just saved; each row
// comes in 6px from below, 24ms after the previous one (only the first dozen wait, so long lists stay quick).
function listClassName(surface: Surface, className?: string) {
  return cn(
    surface === "panel" && "glass-panel flex flex-col gap-0.5 rounded-[18px] p-1.5",
    surface === "inset" && "flex flex-col gap-1.5",
    surface === "grid" && "grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
    surface === "tiles" && "grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2",
    className,
  );
}

function rowClassName(surface: Surface, highlighted: boolean) {
  if (surface === "tiles") {
    return cn(
      "glass-plate group/card relative flex animate-[admin-row-in_var(--transition-duration-base)_var(--ease-ui)_backwards] flex-col rounded-[14px] p-1.5 transition-shadow duration-base ease-ui focus-within:z-10 hover:z-10",
      highlighted && "ring-2 ring-primary/40",
    );
  }
  if (surface === "grid") {
    // A card lifts 1px on hover (design system v2, "Панели"); the one just saved carries a blue ring.
    return cn(
      "glass-panel group/card relative flex animate-[admin-row-in_var(--transition-duration-base)_var(--ease-ui)_backwards] flex-col rounded-[18px] p-2.5 transition-[translate,box-shadow] duration-base ease-ui hover:z-10 hover:-translate-y-px focus-within:z-10",
      highlighted && "ring-2 ring-primary/40",
    );
  }
  return cn(
    "relative flex animate-[admin-row-in_var(--transition-duration-base)_var(--ease-ui)_backwards] items-start gap-2 rounded-[12px] px-2 py-2 transition-colors duration-fast ease-ui hover:z-10 focus-within:z-10 md:items-center",
    surface === "inset" ? "glass-plate" : "hover:bg-accent",
    highlighted && "bg-accent-strong",
  );
}

function rowDelay(index: number): React.CSSProperties {
  return { animationDelay: `${Math.min(index, 12) * 24}ms` };
}

// Generic drag-and-drop reorderable list (@dnd-kit) — reused for the
// products list, a product's photos, and its characteristics, so the DnD
// wiring is written once instead of three times.
//
// DndContext is only ever rendered client-side (after mount): @dnd-kit
// assigns each DndContext an aria-describedby id from a module-level
// counter, not React's SSR-safe useId(), so two independent SortableLists
// on one page (photos + characteristics) get mismatched ids between the
// server-rendered HTML and the client's first render. Skipping SSR for the
// DnD wrapper avoids the mismatch outright; the plain, non-draggable list
// shown before mount is a fine first paint for an auth-gated admin page.
export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  className,
  disabled,
  getFlashKey,
  highlightedKey,
  enableStepButtons,
  surface = "panel",
}: SortableListProps<T>) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate hasMounted flip to skip SSR for DndContext (see comment above); there's no external state to synchronize, just "is this the client yet".
  useEffect(() => setMounted(true), []);
  const flashKeyOf = getFlashKey ?? getId;

  function moveStep(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    onReorder(arrayMove(items, index, targetIndex));
  }

  if (!mounted || disabled) {
    return (
      <div className={listClassName(surface, className)}>
        {items.map((item, index) => (
          <div
            key={getId(item)}
            data-flash-key={flashKeyOf(item)}
            style={rowDelay(index)}
            className={rowClassName(surface, highlightedKey === flashKeyOf(item))}
          >
            {enableStepButtons && !disabled && (
              <StepButtons
                onMoveUp={() => moveStep(index, -1)}
                onMoveDown={() => moveStep(index, 1)}
                disabledUp={index === 0}
                disabledDown={index === items.length - 1}
              />
            )}
            <div className="min-w-0 flex-1">{renderItem(item)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <SortableListClient
      items={items}
      getId={getId}
      onReorder={onReorder}
      renderItem={renderItem}
      className={className}
      getFlashKey={getFlashKey}
      highlightedKey={highlightedKey}
      enableStepButtons={enableStepButtons}
      surface={surface}
    />
  );
}

// Visible only below `md` — on pointer/mouse the drag handle already has a
// clear affordance, and doubling the controls there is just noise.
function StepButtons({
  onMoveUp,
  onMoveDown,
  disabledUp,
  disabledDown,
}: {
  onMoveUp: () => void;
  onMoveDown: () => void;
  disabledUp: boolean;
  disabledDown: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1 md:hidden">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={disabledUp}
        aria-label="Переместить выше"
        className="flex min-h-11 min-w-8 items-center justify-center rounded text-faint-foreground transition-colors hover:bg-accent hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={disabledDown}
        aria-label="Переместить ниже"
        className="flex min-h-11 min-w-8 items-center justify-center rounded text-faint-foreground transition-colors hover:bg-accent hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
}

function SortableListClient<T>({
  items,
  getId,
  onReorder,
  renderItem,
  className,
  getFlashKey,
  highlightedKey,
  enableStepButtons,
  surface = "panel",
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const flashKeyOf = getFlashKey ?? getId;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => getId(item) === active.id);
    const newIndex = items.findIndex((item) => getId(item) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    onReorder(arrayMove(items, index, targetIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(getId)} strategy={surface === "grid" || surface === "tiles" ? rectSortingStrategy : verticalListSortingStrategy}>
        <div className={listClassName(surface, className)}>
          {items.map((item, index) => (
            <SortableRow
              key={getId(item)}
              id={getId(item)}
              index={index}
              surface={surface}
              flashKey={flashKeyOf(item)}
              highlighted={highlightedKey === flashKeyOf(item)}
              stepButtons={
                enableStepButtons
                  ? { onMoveUp: () => moveStep(index, -1), onMoveDown: () => moveStep(index, 1), disabledUp: index === 0, disabledDown: index === items.length - 1 }
                  : undefined
              }
            >
              {renderItem(item)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  index,
  surface,
  flashKey,
  highlighted,
  stepButtons,
  children,
}: {
  id: string;
  index: number;
  surface: Surface;
  flashKey: string;
  highlighted: boolean;
  stepButtons?: { onMoveUp: () => void; onMoveDown: () => void; disabledUp: boolean; disabledDown: boolean };
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { ...rowDelay(index), transform: CSS.Transform.toString(transform), transition };
  const dragHandle = (
    <button
      type="button"
      data-admin-press-feedback="tone-only"
      {...attributes}
      {...listeners}
      aria-label="Перетащить для изменения порядка"
      className={
        surface === "tiles"
          ? "glass-float absolute top-3 left-3 z-10 flex size-8 touch-none items-center justify-center rounded-[8px] text-muted-foreground opacity-0 transition-[opacity,color] duration-fast ease-ui hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100 active:cursor-grabbing pointer-coarse:opacity-100 md:cursor-grab"
          : surface === "grid"
          ? "glass-float absolute top-4 left-4 z-10 flex size-9 touch-none items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing md:cursor-grab"
          : "flex min-h-11 min-w-8 shrink-0 touch-none items-center justify-center rounded-[8px] text-faint-foreground transition-colors hover:bg-accent hover:text-muted-foreground active:cursor-grabbing md:min-h-8 md:min-w-6 md:cursor-grab"
      }
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-flash-key={flashKey}
      className={cn(rowClassName(surface, highlighted), isDragging && "z-20 bg-secondary opacity-90 shadow-lg")}
    >
      {stepButtons ? (
        <div className="flex shrink-0 flex-col items-center md:contents">
          <StepButtons
            onMoveUp={stepButtons.onMoveUp}
            onMoveDown={stepButtons.onMoveDown}
            disabledUp={stepButtons.disabledUp}
            disabledDown={stepButtons.disabledDown}
          />
          {dragHandle}
        </div>
      ) : dragHandle}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
