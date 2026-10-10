// Build-time stand-in for `next/font/local` (used only to render the static 404 page): the fonts
// themselves come from the admin stylesheet, so the generated class names are empty.
export default function localFont() {
  return { variable: "", className: "", style: {} };
}
