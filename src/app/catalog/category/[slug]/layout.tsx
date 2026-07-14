import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { BackButton } from "@/components/ui/BackButton";

// Shared shell for every category page (subcategory grids, brand grids,
// and the "in development" placeholder) so the back button sits in the same
// spot with the same gap below it everywhere, instead of each page redefining it.
export default function CategoryLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      <BackButton />
      <div className="mt-[15px]">{children}</div>
    </Container>
  );
}
