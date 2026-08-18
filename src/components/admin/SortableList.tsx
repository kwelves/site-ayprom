"use client";

import { useEffect, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
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
      <div className={cn("flex flex-col gap-2", className)}>
        {items.map((item, index) => (
          <div
            key={getId(item)}
            data-flash-key={flashKeyOf(item)}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-card p-2 transition-colors duration-fast ease-ui",
              highlightedKey === flashKeyOf(item) && "border-border-interactive bg-accent"
            )}
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
    <div className="flex shrink-0 flex-col md:hidden">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={disabledUp}
        aria-label="Переместить выше"
        className="rounded p-1 text-faint-foreground transition-colors hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={disabledDown}
        aria-label="Переместить ниже"
        className="rounded p-1 text-faint-foreground transition-colors hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-30"
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
      <SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}>
        <div className={cn("flex flex-col gap-2", className)}>
          {items.map((item, index) => (
            <SortableRow
              key={getId(item)}
              id={getId(item)}
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
  flashKey,
  highlighted,
  stepButtons,
  children,
}: {
  id: string;
  flashKey: string;
  highlighted: boolean;
  stepButtons?: { onMoveUp: () => void; onMoveDown: () => void; disabledUp: boolean; disabledDown: boolean };
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-flash-key={flashKey}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-card p-2 transition-colors duration-fast ease-ui",
        isDragging && "opacity-50",
        highlighted && "border-border-interactive bg-accent"
      )}
    >
      {stepButtons && (
        <StepButtons
          onMoveUp={stepButtons.onMoveUp}
          onMoveDown={stepButtons.onMoveDown}
          disabledUp={stepButtons.disabledUp}
          disabledDown={stepButtons.disabledDown}
        />
      )}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Перетащить для изменения порядка"
        className="-m-2 shrink-0 cursor-grab touch-none p-2 text-faint-foreground transition-colors hover:text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
