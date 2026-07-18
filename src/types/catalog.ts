import type { ComponentType, SVGProps } from "react";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type CategoryIcon = "hydraulic-pump" | "pto" | "pto-shaft" | "tank";

export interface Category {
  slug: string;
  name: string;
  description: string;
  icon: CategoryIcon;
  image: string;
  /** Short (2-3 sentence) explainer of what this product type is — shown on
   * the category's brand-selection page (categories that split by brand,
   * e.g. pto/pto-shafts) since that explanation doesn't vary by brand.
   * Categories that split by subcategory instead carry this on
   * Subcategory.intro, since the explanation there does vary. Optional. */
  intro?: string;
  /** Whether this category's products are browsed by subcategory
   * (hydraulic-pumps/tanks) or by brand (pto/pto-shafts) — an explicit,
   * database-enforced column now, replacing the old convention of inferring
   * it from which lookup table had an entry for the category's slug. */
  type: "subcategory" | "brand";
}

export interface Subcategory {
  slug: string;
  name: string;
  image: string;
  /** Short (2-3 sentence) explainer shown at the top of the subcategory's
   * product-grid page — what this specific product type is and when it's
   * used, not marketing copy. Optional so a new subcategory can ship without
   * it and just omit the paragraph. */
  intro?: string;
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

export interface ProductCharacteristic {
  attribute: string;
  value: string;
}

export interface Product {
  slug: string;
  name: string;
  /** Category slug. */
  category: string;
  /** Subcategory slug — only present when `category` is a subcategory-type
   * category (hydraulic-pumps/tanks). Not enforced by the type; whoever
   * enters the data is responsible for the pairing. */
  subcategory?: string;
  /** Brand slugs this product fits. Present on every product regardless of
   * category type; can be empty — a product with no brands yet just doesn't
   * show up on any brand page, which is a normal "not filled in" state. */
  compatibleBrands: string[];
  /** At least one required — images[0] is the cover shown in product cards. */
  images: string[];
  /** Required so the product card never renders without any text. */
  shortDescription: string;
  /** Optional — the product page simply omits this block when absent. */
  description?: string;
  /** Ordered, free-text attribute/value pairs — no fixed per-category vocabulary. */
  characteristics?: ProductCharacteristic[];
  article?: string;
}
