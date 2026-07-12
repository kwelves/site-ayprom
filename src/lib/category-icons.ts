import { Cog, Disc3, Fan, Link2, Package, Settings2, SlidersHorizontal, Wind, type LucideIcon } from "lucide-react";
import type { CategoryIcon } from "@/types/catalog";

export const categoryIconMap: Record<CategoryIcon, LucideIcon> = {
  "gear-pump": Cog,
  "piston-pump": Disc3,
  pto: Settings2,
  valve: SlidersHorizontal,
  pneumatic: Wind,
  "tank-cooling": Fan,
  fitting: Link2,
  accessory: Package,
};
