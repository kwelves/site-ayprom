const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function isPortablePathSegment(segment: string): boolean {
  if (
    segment === "" ||
    segment === "." ||
    segment === ".." ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    /[\\/%:<>"|?*#\u0000-\u001f\u007f]/.test(segment)
  ) {
    return false;
  }

  const basename = segment.split(".", 1)[0].trimEnd();
  return !windowsDeviceName.test(basename);
}
