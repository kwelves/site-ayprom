"use client";

import { useEffect, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
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
}: SortableListProps<T>) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate hasMounted flip to skip SSR for DndContext (see comment above); there's no external state to synchronize, just "is this the client yet".
  useEffect(() => setMounted(true), []);
  const flashKeyOf = getFlashKey ?? getId;

  if (!mounted || disabled) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {items.map((item) => (
          <div
            key={getId(item)}
            data-flash-key={flashKeyOf(item)}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-card p-2 transition-colors duration-300",
              highlightedKey === flashKeyOf(item) && "border-blue-300 bg-blue-50"
            )}
          >
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
    />
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
}: SortableListProps<T>) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const flashKeyOf = getFlashKey ?? getId;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => getId(item) === active.id);
    const newIndex = items.findIndex((item) => getId(item) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}>
        <div className={cn("flex flex-col gap-2", className)}>
          {items.map((item) => (
            <SortableRow
              key={getId(item)}
              id={getId(item)}
              flashKey={flashKeyOf(item)}
              highlighted={highlightedKey === flashKeyOf(item)}
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
  children,
}: {
  id: string;
  flashKey: string;
  highlighted: boolean;
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
        "flex items-center gap-2 rounded-md border border-border bg-card p-2 transition-colors duration-300",
        isDragging && "opacity-50",
        highlighted && "border-blue-300 bg-blue-50"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Перетащить для изменения порядка"
        className="-m-2 shrink-0 cursor-grab touch-none p-2 text-slate-400 transition-colors hover:text-slate-600 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
