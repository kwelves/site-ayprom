import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
// import { BackButton } from "@/components/ui/BackButton";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

// Mirrors src/app/catalog/category/[slug]/layout.tsx — same back-button +
// breadcrumb row and gap, kept consistent across every detail-style page.
//
// BackButton is temporarily hidden (not deleted) to preview the layout
// without it — uncomment the import and <BackButton /> below to restore it.
export default function BrandLayout({ children }: { children: ReactNode }) {
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
