import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getVehicleShowcaseData } from "@/lib/queries/vehicle-hotspots";
import { VehicleShowcaseInteractive, type VehicleVisual } from "./vehicle-showcase/VehicleShowcaseInteractive";

// Image + native frame proportions are presentation geometry tied to the
// specific showcase photo crop (from the approved Figma reference) — not
// stored in vehicle_types, same convention as the old placement/shadows
// system this section replaces (see project memory). Using object-cover at
// this exact aspect ratio reproduces Figma's own fill-to-frame crop almost
// exactly, which is what the vehicle_hotspots x_pct/y_pct coordinates were
// measured against.
const VEHICLE_VISUALS: Record<string, VehicleVisual> = {
  "kran-manipulyator": { image: "/images/vehicle-showcase/kran-manipulyator.png", aspectRatio: 1086 / 768 },
  musorovoz: { image: "/images/vehicle-showcase/musorovoz.png", aspectRatio: 1024 / 738 },
  avtovoz: { image: "/images/vehicle-showcase/avtovoz.png", aspectRatio: 1086 / 717 },
  samosval: { image: "/images/vehicle-showcase/samosval.png", aspectRatio: 1034 / 773 },
  tyagach: { image: "/images/vehicle-showcase/tyagach.png", aspectRatio: 1086 / 1099 },
};

export async function VehicleShowcaseSection() {
  const entries = await getVehicleShowcaseData();
  if (entries.length === 0) return null;

  return (
    <section
      id="vehicle-showcase"
      className="relative scroll-mt-16 overflow-hidden bg-[#060b16] py-16 sm:py-20"
    >
      {/* Faint circuit-board grid — pure CSS, no image asset needed */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(94,152,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(94,152,255,0.6) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,116,255,0.16),transparent_60%)]"
      />

      <Container className="relative z-10">
        <SectionHeading
          eyebrow="Спецтехника"
          title="Оборудование для спецтехники"
          description="Нажмите на отмеченную точку на фото техники, чтобы увидеть подходящую деталь для этого узла."
          className="mx-auto max-w-2xl text-center"
          tone="inverse"
        />

        <div className="mt-10">
          <VehicleShowcaseInteractive entries={entries} visuals={VEHICLE_VISUALS} defaultSlug="kran-manipulyator" />
        </div>
      </Container>
    </section>
  );
}
