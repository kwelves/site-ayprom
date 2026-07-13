import type { ComponentType, SVGProps } from "react";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type CategoryIcon = "hydraulic-pump" | "pto" | "pto-shaft" | "tank";

export interface Category {
  slug: string;
  name: string;
  description: string;
  icon: CategoryIcon;
  image: string;
}

export interface Brand {
  slug: string;
  name: string;
  country: string;
  logo: string;
  /** Visual scale correction for logos whose source SVG has extra baked-in
   * padding (or very little), so all cards read as equally "full". Default 1. */
  logoScale?: number;
}
