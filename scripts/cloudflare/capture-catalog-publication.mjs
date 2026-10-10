#!/usr/bin/env node
// Local-only entry point until the remote publication gates are implemented.
// node scripts/cloudflare/capture-catalog-publication.mjs --local --revision N --release UUID
// Private process env: SUPABASE_URL, ADMIN_SUPABASE_KEY,
// CATALOG_PUBLICATION_CAPABILITY_HASH. Never pass those to a Next child.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
  const args = process.argv.slice(2);
  if (args.length !== 5 || args[0] !== "--local" || args[1] !== "--revision" || args[3] !== "--release"
    || !/^(0|[1-9][0-9]*)$/.test(args[2]) || !process.features.typescript) throw new Error();
  const url = new URL(process.env.SUPABASE_URL);
  if (url.origin !== "http://127.0.0.1:56421" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(root, "src") } });
  const { captureCatalogPublication, createCatalogPublicationCaptureSource } = await import(pathToFileURL(path.join(root,
    "src/cloudflare/static-build/producer/catalog-publication-capture.ts")).href);
  const result = await captureCatalogPublication({ expectedRevision: Number(args[2]), releaseId: args[4],
    capabilityHash: process.env.CATALOG_PUBLICATION_CAPABILITY_HASH,
    source: createCatalogPublicationCaptureSource({ SUPABASE_URL: url.origin, ADMIN_SUPABASE_KEY: process.env.ADMIN_SUPABASE_KEY }),
  });
  console.log(JSON.stringify({ ok: true, ...result }));
} catch {
  console.error(JSON.stringify({ ok: false, code: "catalog_capture_failed" }));
  process.exitCode = 1;
}
