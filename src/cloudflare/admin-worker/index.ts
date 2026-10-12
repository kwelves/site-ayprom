import * as actions from "@/lib/admin/actions";
import * as queries from "@/lib/admin/queries";
import * as importActions from "@/lib/admin/product-import-actions";
import { disableCredentialRequestSharing, getAdminCredentialVersion } from "@/lib/admin/credentials";
import { getCategories } from "@/lib/queries/categories";
import { getAllSubcategories } from "@/lib/queries/subcategories";
import { getBrands } from "@/lib/queries/brands";
import { getVehicleTypes } from "@/lib/queries/vehicle-types";
import { handleAdminRpc, type AdminRpcAction } from "./rpc";
import { routeAdminRequest, type AssetsBinding } from "./routing";
import { runWithBackground } from "@/lib/background-tasks";
import { createGuardedFetch } from "./fetch-guard";
import { applyAdminSecurityHeaders } from "./security-headers";

// Every database call made by the shared admin code goes through the guarded fetch (timeout, one retry of reads).
globalThis.fetch = createGuardedFetch(globalThis.fetch.bind(globalThis));
// A cancelled request must not leave other requests waiting on its unfinished database call.
disableCredentialRequestSharing();

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
  // CSV import (preview and commit) lives in its own module.
  previewProductImport: importActions.previewProductImport as AdminRpcAction,
  commitProductImport: importActions.commitProductImport as AdminRpcAction,
};

// The Next admin accepted uploads up to 4 MB; base64 inside JSON adds a third on top.
const UPLOAD_BODY_LIMIT = 6 * 1024 * 1024;
// The CSV import accepts files up to 5 MB, which base64 grows to about 6.7 MB.
const IMPORT_BODY_LIMIT = 8 * 1024 * 1024;
const bodyLimits: Record<string, number> = {
  previewProductImport: IMPORT_BODY_LIMIT,
  commitProductImport: IMPORT_BODY_LIMIT,
  ...Object.fromEntries(
    [
      "createBrand", "replaceBrandLogo", "createCategory", "replaceCategoryImage", "createSubcategory",
      "replaceSubcategoryImage", "createVehicleType", "updateVehicleType", "createProduct", "updateProduct",
      "uploadProductImage",
    ].map((name) => [name, UPLOAD_BODY_LIMIT]),
  ),
};

interface AdminWorkerEnv {
  ADMIN_SESSION_SECRET: string;
  ASSETS: AssetsBinding;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_MEDIA_BASE_URL?: string;
}

const worker = {
  async fetch(request: Request, env: AdminWorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    // Every answer, including redirects, errors and static files, carries the security headers.
    return applyAdminSecurityHeaders(await respond(request, env, ctx), env);
  },
};

function respond(request: Request, env: AdminWorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
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
}

export default worker;
