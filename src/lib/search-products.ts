import { categories } from "@/data/categories";
import { subcategoriesByCategory } from "@/data/subcategories";
import { brands } from "@/data/brands";
import { brandAliases } from "@/data/brand-aliases";
import type { Product } from "@/types/catalog";

// Plain (non-AI) search across name, article, category, subcategory,
// compatible brand names, and characteristics — matches PROJECT_BRIEF's
// first-version search spec. Every word in the query must appear somewhere
// in the combined text (AND, not OR) — closer to how people actually use a
// multi-word query than "match any word".
function buildSearchText(product: Product): string {
  const parts: string[] = [product.name];

  if (product.article) {
    parts.push(product.article);
  }

  const category = categories.find((item) => item.slug === product.category);
  if (category) {
    parts.push(category.name);
  }

  if (product.subcategory) {
    const subcategory = subcategoriesByCategory[product.category]?.find(
      (item) => item.slug === product.subcategory
    );
    if (subcategory) {
      parts.push(subcategory.name);
    }
  }

  for (const brandSlug of product.compatibleBrands) {
    const brand = brands.find((item) => item.slug === brandSlug);
    if (brand) {
      parts.push(brand.name);
    }
    const aliases = brandAliases[brandSlug];
    if (aliases) {
      parts.push(...aliases);
    }
  }

  if (product.characteristics) {
    for (const { attribute, value } of product.characteristics) {
      parts.push(attribute, value);
    }
  }

  return parts.join(" ").toLowerCase();
}

export function searchProducts(products: Product[], query: string): Product[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return products;

  return products.filter((product) => {
    const haystack = buildSearchText(product);
    return words.every((word) => haystack.includes(word));
  });
}
