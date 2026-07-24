import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { VehicleShowcaseCard } from "@/components/home/VehicleShowcaseCard";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";

interface VehiclePlacement {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  rotateDeg?: number;
  flipX?: boolean;
}

interface ShadowSpec {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  opacity: number;
  blurPx: number;
  rotateDeg: number;
}

// Image assets, native dimensions, and per-vehicle placement/shadow geometry
// aren't stored in vehicle_types (that table only holds slug/name/order), so
// they're kept here alongside the slugs they decorate. Each vehicle photo has
// its own crop and proportions, so placement and shadows are computed
// per-vehicle (as % of the aspect-4/3 scene) rather than shared.
const vehicleVisuals: Record<
  string,
  {
    image: string;
    nativeWidth: number;
    nativeHeight: number;
    placement: VehiclePlacement;
    shadows: ShadowSpec[];
  }
> = {
  samosval: {
    image: "/images/vehicles/samosval.png",
    nativeWidth: 612,
    nativeHeight: 408,
    placement: {
      leftPct: -2.49,
      topPct: 20.31,
      widthPct: 90.58,
      heightPct: 80.52,
    },
    shadows: [],
  },
  "kran-manipulyator": {
    image: "/images/vehicles/kran-manipulyator.png",
    nativeWidth: 726,
    nativeHeight: 343,
    placement: {
      leftPct: -9.42,
      topPct: 22.9,
      widthPct: 109.42,
      heightPct: 68.7,
    },
    shadows: [
      {
        leftPct: 15.5,
        topPct: 71.28,
        widthPct: 69.25,
        heightPct: 14.77,
        opacity: 0.79,
        blurPx: 7.45,
        rotateDeg: -3.99,
      },
      {
        leftPct: 17.04,
        topPct: 73.87,
        widthPct: 34.22,
        heightPct: 16.04,
        opacity: 0.54,
        blurPx: 8.9,
        rotateDeg: 8.51,
      },
    ],
  },
  tyagach: {
    image: "/images/vehicles/tyagach.png",
    nativeWidth: 577,
    nativeHeight: 433,
    placement: {
      leftPct: 8.59,
      topPct: 0,
      widthPct: 92.8,
      heightPct: 93.07,
      flipX: true,
    },
    shadows: [],
  },
  avtovoz: {
    image: "/images/vehicles/avtovoz.png",
    nativeWidth: 612,
    nativeHeight: 408,
    placement: {
      leftPct: 14.56,
      topPct: 12.83,
      widthPct: 82.77,
      heightPct: 73.58,
      rotateDeg: 5.43866,
    },
    shadows: [
      {
        leftPct: 24.79,
        topPct: 74.24,
        widthPct: 58.5,
        heightPct: 12.02,
        opacity: 0.88,
        blurPx: 8.9,
        rotateDeg: -3.76,
      },
      {
        leftPct: 25.07,
        topPct: 73.13,
        widthPct: 34.22,
        heightPct: 16.04,
        opacity: 0.54,
        blurPx: 8.9,
        rotateDeg: 8.51,
      },
    ],
  },
};

export async function VehicleShowcaseSection() {
  const vehicleTypes = await getVehicleTypes();
  const showcaseTypes = vehicleTypes.filter((vehicleType) => vehicleType.slug in vehicleVisuals);

  if (showcaseTypes.length === 0) return null;

  return (
    <section id="vehicle-showcase" className="scroll-mt-16 bg-muted py-14 sm:py-16">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Спецтехника"
            title="Оборудование для спецтехники"
            description="Подберите технику под задачи перевозки, строительства и монтажа — от самосвалов до кранов-манипуляторов."
            className="mx-auto max-w-2xl text-center"
          />
        </Reveal>

        <StaggerGroup className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {showcaseTypes.map((vehicleType) => {
            const visual = vehicleVisuals[vehicleType.slug];
            return (
              <StaggerItem key={vehicleType.slug}>
                <VehicleShowcaseCard
                  href={`/catalog/vehicle-type/${vehicleType.slug}`}
                  name={vehicleType.name}
                  image={visual.image}
                  nativeWidth={visual.nativeWidth}
                  nativeHeight={visual.nativeHeight}
                  placement={visual.placement}
                  shadows={visual.shadows}
                />
              </StaggerItem>
            );
          })}
        </StaggerGroup>
      </Container>
    </section>
  );
}
