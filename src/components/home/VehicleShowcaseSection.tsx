import { Container } from "@/components/ui/Container";
import { getVehicleShowcaseData } from "@/lib/queries/vehicle-hotspots";
import { VehicleShowcaseHeading } from "./vehicle-showcase/VehicleShowcaseHeading";
import { VehicleShowcaseInteractive, type VehicleVisual } from "./vehicle-showcase/VehicleShowcaseInteractive";

// Native pixel dimensions of each showcase photo. The stage itself is a
// single fixed aspect ratio shared by all vehicles (so switching vehicles
// never resizes the section) and each photo is shown via object-contain —
// the whole vehicle always fits, never cropped. vehicle_hotspots.x_pct/
// y_pct are measured against these native dimensions (% of the full photo,
// not of the stage box), so hotspot placement has to account for the
// contain-fit letterboxing at render time — see useContainRect.
// `scale` inflates the vehicle beyond strict contain-fit (1 = fits exactly)
// — hotspots are positioned from the same scaled rect, so they stay pinned
// to the same physical spot on the truck as it grows, without their own
// x_pct/y_pct or 44px size changing. Tyagach gets a smaller bump than the
// rest because its native crop is already the tallest/most vertical of the
// five and clips against the stage sooner.
// `desktopScale` inflates the vehicle beyond strict contain-fit at lg —
// the stage clips at that breakpoint (see VehicleShowcaseInteractive), so
// growing this only trims a bit more off the vehicle's outermost edge
// rather than risking overlap with the card/carousel. Per-vehicle bumps
// stacked across two rounds of user feedback that the technика still read
// too small next to the hotspot circles: kran-manipulyator +15% then +6%
// (1.29 → 1.37), musorovoz +15% then +7% (1.29 → 1.38), avtovoz +15% then
// +8% (1.29 → 1.39), samosval +15% then +4% (1.29 → 1.34). The vehicle_type
// *named* "Тонар" in the DB is this slug ("tyagach" — a DAF tractor pulling
// a raised Tonar dump trailer, confirmed live in-browser; samosval is the
// separate rigid HOWO dump truck) — it got the smaller "Тонар" bumps both
// rounds (+7% then no further mention, 1.05 → 1.12) since its silhouette
// sits closer to the stage edges already.
// Mobile/tablet `scale` (everything below lg, where `desktopScale` above
// takes over instead) dropped 10% per user feedback that these 4 read too
// big on phones: kran-manipulyator/musorovoz/avtovoz/samosval 2 → 1.8.
// Тонар (tyagach) wasn't mentioned, so its 1.6 is untouched.
const VEHICLE_VISUALS: Record<string, VehicleVisual> = {
  "kran-manipulyator": { image: "/images/vehicle-showcase/kran-manipulyator.png", naturalWidth: 1086, naturalHeight: 1448, scale: 1.8, desktopScale: 1.507 },
  musorovoz: { image: "/images/vehicle-showcase/musorovoz.png", naturalWidth: 1024, naturalHeight: 1536, scale: 1.8, desktopScale: 1.518 },
  avtovoz: { image: "/images/vehicle-showcase/avtovoz.png", naturalWidth: 1086, naturalHeight: 1448, scale: 1.8, desktopScale: 1.529 },
  samosval: { image: "/images/vehicle-showcase/samosval.png", naturalWidth: 1086, naturalHeight: 1448, scale: 1.8, desktopScale: 1.474 },
  tyagach: { image: "/images/vehicle-showcase/tyagach.png", naturalWidth: 1086, naturalHeight: 1448, scale: 1.6, desktopScale: 1.232 },
};

export async function VehicleShowcaseSection() {
  const entries = await getVehicleShowcaseData();
  if (entries.length === 0) return null;

  return (
    <section
      id="vehicle-showcase"
      className="relative scroll-mt-16 overflow-hidden bg-[#060b16] py-16 sm:py-20 lg:flex lg:h-[calc(100dvh-4rem+6rem)] lg:flex-col lg:py-6"
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

      <Container className="relative z-10 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <VehicleShowcaseHeading title="Гидравлика на вашей технике" />

        <div className="mt-8 lg:mt-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <VehicleShowcaseInteractive entries={entries} visuals={VEHICLE_VISUALS} defaultSlug="kran-manipulyator" />
        </div>
      </Container>
    </section>
  );
}
