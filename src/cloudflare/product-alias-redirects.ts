export interface ProductAliasRedirect {
  path: string;
  redirectTo: string;
  status: 308;
}

// Framework-neutral; the generated Worker entry gives this only aliases from
// its frozen manifest. No database read or service-role credential is needed.
export function createProductAliasRedirectHandler(aliases: readonly ProductAliasRedirect[]) {
  const targets = new Map<string, string>();
  for (const alias of aliases) {
    if (!/^\/product\/[a-z0-9-]+$/.test(alias.path)
      || !/^\/(?!\/)[a-z0-9/-]+$/.test(alias.redirectTo)
      || alias.redirectTo.includes("//") || alias.status !== 308 || targets.has(alias.path)) {
      throw new Error("invalid_product_alias");
    }
    targets.set(alias.path, alias.redirectTo);
  }
  return (request: Request): Response | null => {
    if (request.method !== "GET" && request.method !== "HEAD") return null;
    const url = new URL(request.url);
    const target = targets.get(url.pathname);
    if (!target) return null;
    return new Response(null, {
      status: 308,
      headers: { location: new URL(target, url.origin).toString(), "cache-control": "public, max-age=300" },
    });
  };
}
