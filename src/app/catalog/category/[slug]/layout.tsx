import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
// import { BackButton } from "@/components/ui/BackButton";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

// Shared shell for every category page (subcategory grids, brand grids,
// and the "in development" placeholder) so the back button and breadcrumb
// sit in the same spot with the same gap below them everywhere, instead of
// each page redefining it.
//
// BackButton is temporarily hidden (not deleted) to preview the layout
// without it — uncomment the import and <BackButton /> below to restore it.
export default function CategoryLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* <BackButton /> */}
        <Breadcrumb />
      </div>
      <div className="mt-[8px]">{children}</div>
    </Container>
  );
}
