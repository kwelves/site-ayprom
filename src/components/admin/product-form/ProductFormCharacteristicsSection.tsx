import { Input } from "@/components/admin/ui/Input";
import { SortableList } from "@/components/admin/SortableList";

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

export function ProductFormCharacteristicsSection({
  characteristics,
  onReorder,
  onUpdate,
  onRemove,
  onAdd,
}: ProductFormCharacteristicsSectionProps) {
  return (
    <div>
      {characteristics.length > 0 && (
        <SortableList
          items={characteristics}
          getId={(c) => c.key}
          onReorder={onReorder}
          enableStepButtons
          renderItem={(c) => (
            <div className="flex items-center gap-2">
              <Input
                name="characteristicAttribute"
                placeholder="Атрибут"
                value={c.attribute}
                onChange={(e) => onUpdate(c.key, "attribute", e.target.value)}
                className="flex-1"
              />
              <Input
                name="characteristicValue"
                placeholder="Значение"
                value={c.value}
                onChange={(e) => onUpdate(c.key, "value", e.target.value)}
                className="flex-1"
              />
              <button type="button" onClick={() => onRemove(c.key)} className="shrink-0 text-sm text-danger hover:underline">
                Удалить
              </button>
            </div>
          )}
        />
      )}
      <button type="button" onClick={onAdd} className="mt-3 text-sm text-primary hover:underline">
        + Добавить характеристику
      </button>
    </div>
  );
}
