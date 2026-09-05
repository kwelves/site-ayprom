import { Container } from "@/components/ui/Container";
import { getVehicleShowcaseData } from "@/lib/queries/vehicle-hotspots";
import { VEHICLE_VISUALS } from "@/lib/vehicle-visuals";
import { VehicleShowcaseHeading } from "./vehicle-showcase/VehicleShowcaseHeading";
import { VehicleShowcaseLazy } from "./vehicle-showcase/VehicleShowcaseLazy";
import { VehicleShowcaseShell } from "./vehicle-showcase/VehicleShowcaseShell";

const DEFAULT_VEHICLE_SLUG = "kran-manipulyator";

export async function VehicleShowcaseSection() {
  const entries = await getVehicleShowcaseData();
  if (entries.length === 0) return null;

  return (
    <section
      id="vehicle-showcase"
      className="relative scroll-mt-16 overflow-hidden bg-[#060b16] py-16 sm:py-20 lg:flex lg:min-h-[calc(100dvh-4rem+6rem)] lg:flex-col lg:py-6"
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

      <Container className="relative z-10 lg:flex lg:flex-1 lg:flex-col">
        <VehicleShowcaseHeading title="Гидравлика на вашей технике" />

        <div className="mt-8 lg:mt-4 lg:flex lg:flex-1 lg:flex-col">
          {/* Интерактив (framer-motion, карусель, хотспоты) приезжает
              отдельным чанком только когда секция подошла к экрану. До этого —
              и навсегда, если чанк не загрузится — работает статическая
              витрина, отрисованная на сервере. */}
          <VehicleShowcaseLazy entries={entries} visuals={VEHICLE_VISUALS} defaultSlug={DEFAULT_VEHICLE_SLUG}>
            <VehicleShowcaseShell entries={entries} visuals={VEHICLE_VISUALS} defaultSlug={DEFAULT_VEHICLE_SLUG} />
          </VehicleShowcaseLazy>
        </div>
      </Container>
    </section>
  );
}
