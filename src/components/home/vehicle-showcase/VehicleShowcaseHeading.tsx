// Same two blues already used for this section's circuit grid and radial
// wash (VehicleShowcaseSection.tsx) — reused here instead of --color-brand
// (#084bb9), which reads muddy as a glow against the near-black #060b16 bg.
const GLOW_CORE = "#1474ff";
const GLOW_SOFT = "#5e98ff";

export function VehicleShowcaseHeading({ title }: { title: string }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
      <h2 className="relative z-20 text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
        {title}
      </h2>

      <div className="relative mt-2 h-1 w-full max-w-md">
        <div
          className="absolute inset-x-6 top-0 h-px blur-sm"
          style={{ background: `linear-gradient(to right, transparent, ${GLOW_CORE}, transparent)` }}
        />
        <div
          className="absolute inset-x-6 top-0 h-px"
          style={{ background: `linear-gradient(to right, transparent, ${GLOW_CORE}, transparent)` }}
        />
        <div
          className="absolute inset-x-20 top-0 h-[3px] blur-sm"
          style={{ background: `linear-gradient(to right, transparent, ${GLOW_SOFT}, transparent)` }}
        />
        <div
          className="absolute inset-x-20 top-0 h-px"
          style={{ background: `linear-gradient(to right, transparent, ${GLOW_SOFT}, transparent)` }}
        />
      </div>
    </div>
  );
}
