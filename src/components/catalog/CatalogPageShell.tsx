import type { ReactNode } from "react";
import { BackButton } from "@/components/ui/BackButton";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/Breadcrumb";
import { Container } from "@/components/ui/Container";
import { StructuredData } from "@/components/seo/StructuredData";
import { buildBreadcrumbStructuredData } from "@/lib/breadcrumb-structured-data";

interface CatalogPageShellProps {
  items?: BreadcrumbItem[];
  canonicalPath?: string;
  children: ReactNode;
  appearance?: "default" | "product";
}

/**
 * Shared catalog framing. It deliberately belongs to each leaf page instead
 * of a parent App Router layout: parent layouts are cached during navigation
 * and cannot reliably see changing child segments such as brand or product.
 */
export function CatalogPageShell({ items = [], canonicalPath, children, appearance = "default" }: CatalogPageShellProps) {
  const content = (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <BackButton />
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <Breadcrumb items={items} />
        </div>
      ) : (
        <BackButton fallbackHref="/" />
      )}
      <div className="mt-8 sm:mt-14">{children}</div>
    </Container>
  );

  return (
    <>
      {canonicalPath && items.length > 0 ? (
        <StructuredData data={buildBreadcrumbStructuredData(items, canonicalPath)} />
      ) : null}
      {appearance === "product" ? (
        <div className="bg-product-canvas font-product text-product-ink">{content}</div>
      ) : content}
    </>
  );
}
