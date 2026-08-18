import type { VehicleVisual } from "@/components/home/vehicle-showcase/VehicleShowcaseInteractive";

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
// .webp instead of .png: these five photos are pre-converted static assets
// (see scripts/generate-vehicle-webp.mjs) served directly, bypassing
// next/image's on-demand optimizer — that per-request resize+encode step is
// what made the very first request for any given vehicle noticeably slower
// than later ones. The PNG masters stay in the same folder as the source of
// truth for regeneration; only the reference here changed.
// imageMobile: a second, smaller pre-built file for viewports below `lg`
// (VehicleShowcaseInteractive picks between the two) — the stage shows the
// photo noticeably smaller there, so the full-resolution file was pure waste
// (Lighthouse flagged ~60-99 КБ per photo on mobile before this existed).
// naturalWidth/naturalHeight describe the source crop's aspect ratio only —
// they're the coordinate system hotspot x_pct/y_pct are measured against,
// unrelated to which file gets fetched, so both stay the same either way.
//
// Single source of truth: also imported by the admin panel's read-only
// hotspot preview (VehicleHotspotPreview) so the two surfaces can never
// silently drift into showing different photos for the same slug.
export const VEHICLE_VISUALS: Record<string, VehicleVisual> = {
  "kran-manipulyator": { image: "/images/vehicle-showcase/kran-manipulyator.webp", imageMobile: "/images/vehicle-showcase/kran-manipulyator-mobile.webp", naturalWidth: 1086, naturalHeight: 1448, scale: 1.8, desktopScale: 1.507 },
  musorovoz: { image: "/images/vehicle-showcase/musorovoz.webp", imageMobile: "/images/vehicle-showcase/musorovoz-mobile.webp", naturalWidth: 1024, naturalHeight: 1536, scale: 1.8, desktopScale: 1.518 },
  avtovoz: { image: "/images/vehicle-showcase/avtovoz.webp", imageMobile: "/images/vehicle-showcase/avtovoz-mobile.webp", naturalWidth: 1086, naturalHeight: 1448, scale: 1.8, desktopScale: 1.529 },
  samosval: { image: "/images/vehicle-showcase/samosval.webp", imageMobile: "/images/vehicle-showcase/samosval-mobile.webp", naturalWidth: 1086, naturalHeight: 1448, scale: 1.8, desktopScale: 1.474 },
  tyagach: { image: "/images/vehicle-showcase/tyagach.webp", imageMobile: "/images/vehicle-showcase/tyagach-mobile.webp", naturalWidth: 1086, naturalHeight: 1448, scale: 1.6, desktopScale: 1.232 },
};
