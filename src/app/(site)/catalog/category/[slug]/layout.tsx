import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { BackButton } from "@/components/ui/BackButton";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { getCategory } from "@/lib/queries/categories";

// Shared shell for every category page (subcategory grids, brand grids,
// and the "in development" placeholder) so the back button and breadcrumb
// sit in the same spot with the same gap below them everywhere, instead of
// each page redefining it.
export default async function CategoryLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await getCategory(slug);
  return (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BackButton />
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <Breadcrumb items={category ? [{ label: category.name }] : []} />
      </div>
      <div className="mt-14">{children}</div>
    </Container>
  );
}
