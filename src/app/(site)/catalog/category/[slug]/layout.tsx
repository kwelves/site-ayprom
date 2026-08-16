import type { ReactNode } from "react";

// Breadcrumb framing lives in the leaf pages via CatalogPageShell. Keeping
// this layout structurally transparent lets child routes update their own
// complete trail during client navigation instead of reusing a cached parent
// crumb that only knows the category segment.
export default function CategoryLayout({ children }: { children: ReactNode }) {
  return children;
}
