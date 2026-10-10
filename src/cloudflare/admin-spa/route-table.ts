// Pure route table shared by the browser app and the Worker (no React, no Node).
export interface AdminRoute {
  pattern: string;
  segments: string[];
  file: string;
  protected: boolean;
}

export interface RouteMatch<T extends { segments: string[] } = AdminRoute> {
  route: T;
  params: Record<string, string>;
}

// `/src/app/admin/(protected)/brands/[slug]/edit/page.tsx` -> `/admin/brands/:slug/edit`.
export function buildRouteTable(files: string[]): AdminRoute[] {
  const routes = files
    .filter((file) => file.endsWith("/page.tsx") && file.includes("/app/admin/"))
    .map((file) => {
      const relative = file.slice(file.indexOf("/app/") + "/app".length, -"/page.tsx".length);
      const segments = relative
        .split("/")
        .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
        .map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"));
      return { pattern: `/${segments.join("/")}`, segments, file, protected: file.includes("/(protected)/") };
    });
  // Fixed segments beat parameters, position by position.
  return routes.sort((a, b) => {
    for (let i = 0; i < Math.max(a.segments.length, b.segments.length); i += 1) {
      const left = a.segments[i];
      const right = b.segments[i];
      if (left === undefined || right === undefined) return (left === undefined ? 0 : 1) - (right === undefined ? 0 : 1);
      const leftParam = left.startsWith(":");
      const rightParam = right.startsWith(":");
      if (leftParam !== rightParam) return leftParam ? 1 : -1;
    }
    return 0;
  });
}

function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

export function matchRoute<T extends { segments: string[] }>(table: T[], pathname: string): RouteMatch<T> | null {
  const parts = pathname.split("/").filter(Boolean);
  for (const route of table) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const fits = route.segments.every((segment, index) => {
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeSegment(parts[index]);
        return true;
      }
      return segment === parts[index];
    });
    if (fits) return { route, params };
  }
  return null;
}
