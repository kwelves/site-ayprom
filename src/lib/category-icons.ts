import {
  HydraulicPumpIcon,
  PtoIcon,
  PtoShaftIcon,
  TankIcon,
} from "@/components/icons/category-icons";
import type { CategoryIcon, IconComponent } from "@/types/catalog";

export const categoryIconMap: Record<CategoryIcon, IconComponent> = {
  "hydraulic-pump": HydraulicPumpIcon,
  pto: PtoIcon,
  "pto-shaft": PtoShaftIcon,
  tank: TankIcon,
};
