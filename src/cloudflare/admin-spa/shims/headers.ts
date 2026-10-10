// Browser stand-in for `next/headers`: the admin pages only read the product-list
// preference cookie, which is a normal (non-secret) browser cookie.
export async function cookies() {
  const jar = new Map<string, string>();
  for (const part of (typeof document === "undefined" ? "" : document.cookie).split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const value = part.slice(index + 1).trim();
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { /* keep raw */ }
    jar.set(part.slice(0, index).trim(), decoded);
  }
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
  };
}

export async function headers(): Promise<Headers> {
  return new Headers();
}
