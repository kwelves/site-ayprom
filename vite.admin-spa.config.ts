import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const root = process.cwd();
const spa = (file: string) => path.join(root, "src/cloudflare/admin-spa", file);

// Server modules the pages import by name. In the browser each exported function becomes a call
// to the admin Worker, so the page and component files do not change at all.
// `names`: a pattern that finds the exported functions in the source, or a fixed list of the ones the admin uses.
const SERVER_MODULES: Array<{ suffix: string; id: string; call: string; names: RegExp | string[] }> = [
  { suffix: "/src/lib/admin/actions.ts", id: "\0admin-rpc:actions", call: "rpcCall", names: /export\s+async\s+function\s+(\w+)/g },
  { suffix: "/src/lib/admin/queries.ts", id: "\0admin-rpc:queries", call: "rpcRead", names: /export\s+async\s+function\s+(get\w+)/g },
  // Public catalog readers the product forms use for their drop-down lists.
  { suffix: "/src/lib/queries/categories.ts", id: "\0admin-rpc:categories", call: "rpcRead", names: ["getCategories"] },
  { suffix: "/src/lib/queries/subcategories.ts", id: "\0admin-rpc:subcategories", call: "rpcRead", names: ["getAllSubcategories"] },
  { suffix: "/src/lib/queries/brands.ts", id: "\0admin-rpc:brands", call: "rpcRead", names: ["getBrands"] },
  { suffix: "/src/lib/queries/vehicle-types.ts", id: "\0admin-rpc:vehicle-types", call: "rpcRead", names: ["getVehicleTypes"] },
];

const SERVER_IMPORT = /lib\/(admin\/(actions|queries)|queries\/(categories|subcategories|brands|vehicle-types))$/;

function adminRpcClients(): Plugin {
  return {
    name: "admin-rpc-clients",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source.startsWith("\0admin-rpc:")) return source;
      if (!SERVER_IMPORT.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const normalized = resolved?.id.replaceAll("\\", "/") ?? "";
      return SERVER_MODULES.find((candidate) => normalized.endsWith(candidate.suffix))?.id ?? null;
    },
    load(id) {
      const target = SERVER_MODULES.find((candidate) => candidate.id === id);
      if (!target) return null;
      const names = Array.isArray(target.names)
        ? target.names
        : [...new Set([...readFileSync(path.join(root, target.suffix), "utf8").matchAll(target.names)].map((match) => match[1]))];
      const runtime = JSON.stringify(spa("runtime.ts").replaceAll("\\", "/"));
      return [
        `import { ${target.call} } from ${runtime};`,
        ...names.map((name) => `export const ${name} = (...args) => ${target.call}(${JSON.stringify(name)}, args);`),
      ].join("\n");
    },
  };
}

export default defineConfig({
  root: path.join(root, "src/cloudflare/admin-spa"),
  base: "/",
  publicDir: path.join(root, "public"),
  plugins: [adminRpcClients()],
  resolve: {
    alias: [
      { find: "@", replacement: path.join(root, "src") },
      { find: /^next\/link$/, replacement: spa("shims/link.tsx") },
      { find: /^next\/image$/, replacement: spa("shims/image.tsx") },
      { find: /^next\/navigation$/, replacement: spa("shims/navigation.ts") },
      { find: /^next\/headers$/, replacement: spa("shims/headers.ts") },
      { find: /^server-only$/, replacement: path.join(root, "src/cloudflare/admin-worker/shims/server-only.ts") },
    ],
  },
  build: {
    outDir: path.join(root, "dist/admin-spa"),
    emptyOutDir: true,
    assetsDir: "admin-assets",
    sourcemap: false,
    target: "es2022",
  },
});
