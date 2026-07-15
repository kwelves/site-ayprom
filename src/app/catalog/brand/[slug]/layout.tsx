import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { BackButton } from "@/components/ui/BackButton";

// Mirrors src/app/catalog/category/[slug]/layout.tsx — same back-button
// position and 15px gap, kept consistent across every detail-style page.
export default function BrandLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      <BackButton />
      <div className="mt-[15px]">{children}</div>
    </Container>
  );
}
