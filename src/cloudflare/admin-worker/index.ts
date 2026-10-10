import * as actions from "@/lib/admin/actions";
import * as queries from "@/lib/admin/queries";
import { getAdminCredentialVersion } from "@/lib/admin/credentials";
import { getCategories } from "@/lib/queries/categories";
import { getAllSubcategories } from "@/lib/queries/subcategories";
import { getBrands } from "@/lib/queries/brands";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { handleAdminRpc, type AdminRpcAction } from "./rpc";
import { routeAdminRequest, type AssetsBinding } from "./routing";
import { runWithBackground } from "@/lib/background-tasks";

// The same server functions the Next admin calls, exposed by name. Queries are limited to the
// `get*` readers; a name that is not a function (types, constants) is never exposed.
function functionsOf(source: Record<string, unknown>, accept: (name: string) => boolean): Record<string, AdminRpcAction> {
  return Object.fromEntries(
    Object.entries(source).filter(([name, value]) => typeof value === "function" && accept(name)),
  ) as Record<string, AdminRpcAction>;
}

const registry: Record<string, AdminRpcAction> = {
  // Public catalog readers used by the product forms (drop-down lists).
  getCategories, getAllSubcategories, getBrands, getVehicleTypes,
  ...functionsOf(queries, (name) => name.startsWith("get")),
  ...functionsOf(actions, () => true),
};

// The Next admin accepted uploads up to 4 MB; base64 inside JSON adds a third on top.
const UPLOAD_BODY_LIMIT = 6 * 1024 * 1024;
const bodyLimits = Object.fromEntries(
  [
    "createBrand", "replaceBrandLogo", "createCategory", "replaceCategoryImage", "createSubcategory",
    "replaceSubcategoryImage", "createVehicleType", "updateVehicleType", "createProduct", "updateProduct",
    "uploadProductImage",
  ].map((name) => [name, UPLOAD_BODY_LIMIT]),
);

interface AdminWorkerEnv {
  ADMIN_SESSION_SECRET: string;
  ASSETS: AssetsBinding;
}

const worker = {
  fetch(request: Request, env: AdminWorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    // Work that must outlive the answer (waking the publication worker) goes to the platform's waitUntil.
    return runWithBackground((promise) => ctx.waitUntil(promise), () => routeAdminRequest(request, {
      assets: env.ASSETS,
      rpc: (rpcRequest, name) =>
        handleAdminRpc(rpcRequest, name, {
          registry,
          secret: env.ADMIN_SESSION_SECRET,
          now: Date.now,
          credentialVersion: getAdminCredentialVersion,
          // getAdminCredentialVersion already shares its answer for a few seconds; do not stack a second delay on it.
          credentialCacheMs: 0,
          publicActions: ["login"],
          bodyLimits,
        }),
    }));
  },
};

export default worker;
