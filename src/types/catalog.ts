export type CategoryIcon =
  | "gear-pump"
  | "piston-pump"
  | "pto"
  | "valve"
  | "pneumatic"
  | "tank-cooling"
  | "fitting"
  | "accessory";

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
