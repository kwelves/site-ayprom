import type { ReactNode } from "react";

// See catalog/category/[slug]/layout.tsx: each leaf page owns a complete,
// current breadcrumb trail, so this persistent App Router layout stays only
// as a transparent route boundary.
export default function BrandLayout({ children }: { children: ReactNode }) {
  return children;
}
