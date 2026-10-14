// Module resolution hook for running the TypeScript producer directly under
// Node's built-in type stripping (Node 22.18+/24, `process.features.typescript`).
//
// The source uses two conventions Node's ESM loader does not resolve on its
// own: extensionless relative imports (`./route-manifest`) and the `@/` alias
// for `src/`. This hook maps both onto real `.ts` files and nothing else; it
// performs no transformation and touches no network.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let srcRoot = "";

export function initialize(data) {
  srcRoot = data.srcRoot;
}

export async function resolve(specifier, context, nextResolve) {
  let candidate = specifier;
  if (candidate.startsWith("@/")) {
    candidate = pathToFileURL(path.join(srcRoot, candidate.slice(2))).href;
  }
  if (candidate.startsWith("./") || candidate.startsWith("../") || candidate.startsWith("file:")) {
    const url = candidate.startsWith("file:") ? candidate : new URL(candidate, context.parentURL).href;
    const filePath = fileURLToPath(url);
    if (!path.extname(filePath) || !existsSync(filePath)) {
      for (const suffix of [".ts", "/index.ts"]) {
        const withSuffix = `${filePath}${suffix}`;
        if (existsSync(withSuffix) && statSync(withSuffix).isFile()) {
          return nextResolve(pathToFileURL(withSuffix).href, context);
        }
      }
    }
    return nextResolve(url, context);
  }
  return nextResolve(candidate, context);
}

// The repository package.json declares no "type", so Node would sniff every
// .ts file for module syntax and warn about it. All producer sources are ESM;
// declare the format explicitly instead of touching package.json.
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    return nextLoad(url, { ...context, format: "module-typescript" });
  }
  return nextLoad(url, context);
}
