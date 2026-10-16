import { Plus, X } from "lucide-react";
import { Input } from "@/components/admin/ui/Input";
import { SortableList } from "@/components/admin/SortableList";
import { buttonClassName } from "@/components/admin/ui/button-styles";

interface CharacteristicRow {
  key: string;
  attribute: string;
  value: string;
}

interface ProductFormCharacteristicsSectionProps {
  characteristics: CharacteristicRow[];
  onReorder: (next: CharacteristicRow[]) => void;
  onUpdate: (key: string, field: "attribute" | "value", value: string) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}

// Attribute–value pairs as a small table: the two fields of a row side by side, drag to reorder, remove on the
// right. An empty list says what goes here and offers the one action that fills it.
export function ProductFormCharacteristicsSection({
  characteristics,
  onReorder,
  onUpdate,
  onRemove,
  onAdd,
}: ProductFormCharacteristicsSectionProps) {
  return (
    <div>
      {characteristics.length > 0 ? (
        <SortableList
          surface="inset"
          items={characteristics}
          getId={(c) => c.key}
          onReorder={onReorder}
          enableStepButtons
          renderItem={(c) => (
            <div className="flex items-center gap-2">
              <Input
                name="characteristicAttribute"
                placeholder="Например, давление"
                aria-label="Атрибут"
                value={c.attribute}
                onChange={(e) => onUpdate(c.key, "attribute", e.target.value)}
                className="flex-1 font-medium"
              />
              <Input
                name="characteristicValue"
                placeholder="Например, 250 бар"
                aria-label="Значение"
                value={c.value}
                onChange={(e) => onUpdate(c.key, "value", e.target.value)}
                className="flex-1 tabular-nums"
              />
              <button
                type="button"
                onClick={() => onRemove(c.key)}
                aria-label={c.attribute ? `Удалить характеристику «${c.attribute}»` : "Удалить характеристику"}
                title="Удалить"
                className={buttonClassName({ variant: "ghost", size: "icon", className: "hover:bg-danger-surface hover:text-danger" })}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )}
        />
      ) : (
        <p className="rounded-[12px] border border-dashed border-input px-4 py-5 text-center text-sm text-muted-foreground">
          Характеристик пока нет. Добавьте давление, объём, размеры: всё, по чему покупатель сверяет деталь.
        </p>
      )}
      <button type="button" onClick={onAdd} className={buttonClassName({ variant: "glass", size: "sm", className: "mt-3" })}>
        <Plus aria-hidden="true" className="!size-4" />
        Добавить характеристику
      </button>
    </div>
  );
}
