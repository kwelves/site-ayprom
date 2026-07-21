import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { BackButton } from "@/components/ui/BackButton";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

// Mirrors catalog/category/[slug]/layout.tsx and catalog/brand/[slug]/layout.tsx —
// same Container/BackButton/Breadcrumb shell. Without this, the page rendered
// directly under the root layout's unconstrained <main>, so its product grid
// stretched to the full viewport width instead of the shared max-w-7xl —
// noticeably wider columns than every other catalog grid — and its
// Breadcrumb never mounted at all (resolveCrumbs already handles the
// vehicle-type route, it just had nowhere to render from).
export default function VehicleTypeLayout({ children }: { children: ReactNode }) {
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
