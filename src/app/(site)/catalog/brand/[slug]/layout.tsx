import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { BackButton } from "@/components/ui/BackButton";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

// Mirrors src/app/catalog/category/[slug]/layout.tsx — same back-button +
// breadcrumb row and gap, kept consistent across every detail-style page.
export default function BrandLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BackButton />
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <Breadcrumb />
      </div>
      <div className="mt-14">{children}</div>
    </Container>
  );
}
