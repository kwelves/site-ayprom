import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getVehicleShowcaseData } from "@/lib/queries/vehicle-hotspots";
import { VehicleShowcaseInteractive, type VehicleVisual } from "./vehicle-showcase/VehicleShowcaseInteractive";

// Native pixel dimensions of each showcase photo. The stage itself is a
// single fixed aspect ratio shared by all vehicles (so switching vehicles
// never resizes the section) and each photo is shown via object-contain —
// the whole vehicle always fits, never cropped. vehicle_hotspots.x_pct/
// y_pct are measured against these native dimensions (% of the full photo,
// not of the stage box), so hotspot placement has to account for the
// contain-fit letterboxing at render time — see useContainRect.
const VEHICLE_VISUALS: Record<string, VehicleVisual> = {
  "kran-manipulyator": { image: "/images/vehicle-showcase/kran-manipulyator.png", naturalWidth: 1086, naturalHeight: 1448 },
  musorovoz: { image: "/images/vehicle-showcase/musorovoz.png", naturalWidth: 1024, naturalHeight: 1536 },
  avtovoz: { image: "/images/vehicle-showcase/avtovoz.png", naturalWidth: 1086, naturalHeight: 1448 },
  samosval: { image: "/images/vehicle-showcase/samosval.png", naturalWidth: 1086, naturalHeight: 1448 },
  tyagach: { image: "/images/vehicle-showcase/tyagach.png", naturalWidth: 1086, naturalHeight: 1448 },
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
          eyebrow="Интерактивный подбор"
          title="Гидравлика на вашей технике"
          description="Выберите машину, затем нажмите на отмеченный узел."
          className="max-w-2xl"
          tone="inverse"
        />

        <div className="mt-10">
          <VehicleShowcaseInteractive entries={entries} visuals={VEHICLE_VISUALS} defaultSlug="kran-manipulyator" />
        </div>
      </Container>
    </section>
  );
}
