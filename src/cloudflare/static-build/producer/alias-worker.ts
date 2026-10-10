import type { ProductAliasRedirect } from "../../product-alias-redirects";
import { routePathToOutputFile, type RouteManifestEntry } from "../route-manifest";
import { ProducerError } from "./errors";

export function collectProductAliases(entries: readonly RouteManifestEntry[]): ProductAliasRedirect[] {
  const served = new Set(entries.flatMap((entry) => entry.class === "static" || entry.class === "query" ? [entry.path] : []));
  const seen = new Set<string>();
  const aliases: ProductAliasRedirect[] = [];
  for (const entry of entries) {
    if (entry.class !== "redirect" || entry.family !== "product-alias") continue;
    if (!/^\/product\/[a-z0-9-]+$/.test(entry.path) || seen.has(entry.path)) {
      throw new ProducerError("route_manifest_incomplete", "invalid_product_alias");
    }
    routePathToOutputFile(entry.redirectTo);
    if (!served.has(entry.redirectTo)) {
      throw new ProducerError("route_manifest_incomplete", "alias_target_missing");
    }
    seen.add(entry.path);
    aliases.push({ path: entry.path, redirectTo: entry.redirectTo, status: 308 });
  }
  return aliases.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export function serializeAliasWorkerEntry(
  aliases: readonly ProductAliasRedirect[],
  baseWorkerImport: string,
  aliasHandlerImport: string,
): string {
  return [
    `import baseWorker from ${JSON.stringify(baseWorkerImport)};`,
    `import { createProductAliasRedirectHandler } from ${JSON.stringify(aliasHandlerImport)};`,
    `const redirect = createProductAliasRedirectHandler(${JSON.stringify(aliases)});`,
    "export default { fetch(request, env) { return redirect(request) ?? baseWorker.fetch(request, env); } };",
    "",
  ].join("\n");
}
