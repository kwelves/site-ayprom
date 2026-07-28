import Image from "next/image";

const posterSrc = "/images/vehicle-showcase-poster.webp";

// Static background only — the ambient video was removed for performance on
// mid-range Android (docs/design-orchestration/07-design-decision.md). The
// Hero video stays the only video on the page.
export function VehicleShowcaseBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-slate-950">
      <Image
        src={posterSrc}
        alt=""
        fill
        sizes="100vw"
        className="object-cover"
      />

      <div className="absolute inset-0 bg-slate-950/58" />
      <div className="absolute inset-0 bg-linear-to-b from-slate-950/50 via-transparent to-slate-950/65" />
    </div>
  );
}
