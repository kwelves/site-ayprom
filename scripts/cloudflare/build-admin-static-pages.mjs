// Second half of the admin app build: writes the static 404 page and the list of known admin pages
// next to the built app (dist/admin-spa). Run after `vite build --config vite.admin-spa.config.ts`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const root = process.cwd();
const dist = path.join(root, "dist", "admin-spa");
const out = path.join(root, ".wrangler", "tmp", "admin-static-pages");
const spa = (file) => path.join(root, "src", "cloudflare", "admin-spa", file);

const emptyStyles = { name: "empty-styles", enforce: "pre", resolveId: (id) => (id.endsWith(".css") ? "\0empty-css" : null), load: (id) => (id === "\0empty-css" ? "" : null) };

await build({
  configFile: false,
  root,
  logLevel: "warn",
  plugins: [emptyStyles],
  resolve: {
    alias: [
      { find: "@", replacement: path.join(root, "src") },
      { find: /^next\/link$/, replacement: spa("shims/link.tsx") },
      { find: /^next\/font\/local$/, replacement: spa("shims/font-local.ts") },
    ],
  },
  ssr: { noExternal: true },
  build: {
    ssr: spa("static-pages.tsx"),
    outDir: out,
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { format: "es", entryFileNames: "static-pages.mjs" } },
  },
});

const pages = await import(pathToFileURL(path.join(out, "static-pages.mjs")).href);
const shell = readFileSync(path.join(dist, "index.html"), "utf8");
const stylesheet = shell.match(/href="([^"]+\.css)"/)?.[1];
if (!stylesheet) throw new Error("admin_app_stylesheet_not_found");
writeFileSync(path.join(dist, "admin-404.html"), pages.renderNotFoundDocument(stylesheet));

function pageFiles(directory, prefix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? pageFiles(full, `${prefix}/${entry.name}`) : entry.name === "page.tsx" ? [`${prefix}/page.tsx`] : [];
  });
}
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, "admin-routes.json"), pages.routesJson(pageFiles(path.join(root, "src", "app", "admin"), "/src/app/admin")));
console.log("admin static pages written");
