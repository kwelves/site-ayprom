/** Private PostgREST ports for the external Node/Sharp photo processor. */
import { requestAdminJson } from "../admin/json-request.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PUBLIC_BASE = /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:\/[a-zA-Z0-9_-]+)*$/;
const TYPES = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"],
]);
const MODES = new Set(["normal", "webp", "script", "script-webp"]);

export class MediaJobPortError extends Error {
  constructor() {
    super("media_backend_unavailable");
    this.name = "MediaJobPortError";
    this.code = "media_backend_unavailable";
  }
}

function validJob(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return UUID.test(value.id) && UUID.test(value.draft_id) && UUID.test(value.product_id)
    && UUID.test(value.lease_token) && SHA.test(value.owner_hash) && SHA.test(value.source_sha256)
    && SLUG.test(value.product_slug) && MODES.has(value.mode) && TYPES.has(value.content_type)
    && value.source_key === `product-image-staging/${value.draft_id}/${value.id}/source.${TYPES.get(value.content_type)}`
    && Number.isSafeInteger(value.byte_size) && value.byte_size >= 1 && value.byte_size <= 8 * 1024 * 1024
    && Number.isSafeInteger(value.attempts) && value.attempts >= 1 && value.attempts <= 3
    && Number.isSafeInteger(value.image_order) && value.image_order >= 0 && value.image_order <= 9
    && value.state === "processing" && typeof value.lease_until === "string" && !Number.isNaN(Date.parse(value.lease_until));
}

function validReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !SHA.test(value.inputSha256)) return false;
  for (const kind of ["master", "thumbnail", "gallery"]) {
    const item = value[kind];
    if (!item || typeof item !== "object" || Array.isArray(item)
      || !SHA.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 8 * 1024 * 1024
      || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(item.contentType)
      || typeof item.path !== "string" || item.path.length > 255 || item.path.includes("..") || item.path.startsWith("/")) return false;
  }
  return true;
}

function parseBindings(bindings) {
  try {
    const base = new URL(bindings?.SUPABASE_URL);
    const key = bindings?.MEDIA_SUPABASE_KEY;
    const local = base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if (!(base.protocol === "https:" || local) || base.username || base.password || base.search || base.hash
      || !key || typeof key !== "string" || key !== key.trim() || key.length > 4096 || !/^[\x21-\x7e]+$/.test(key)) throw new Error();
    return { base, key };
  } catch {
    throw new MediaJobPortError();
  }
}

export function createMediaJobPorts(bindings, fetcher = fetch) {
  const { base, key } = parseBindings(bindings);
  if (typeof fetcher !== "function") throw new MediaJobPortError();
  const headers = new Headers({ apikey: key, "content-type": "application/json" });
  // Legacy service_role JWTs need Authorization. Supabase secret keys do not.
  if (key.startsWith("eyJ")) headers.set("authorization", `Bearer ${key}`);

  async function rpc(name, body) {
    try {
      const url = new URL(base);
      url.pathname = `/rest/v1/rpc/${name}`;
      const result = await requestAdminJson(url, { method: "POST", headers, body: JSON.stringify(body) }, fetcher);
      if (!result.ok) throw new MediaJobPortError();
      return result.payload;
    } catch {
      throw new MediaJobPortError();
    }
  }

  return {
    async claim(seconds = 300) {
      if (!Number.isSafeInteger(seconds) || seconds < 5 || seconds > 600) throw new MediaJobPortError();
      const result = await rpc("claim_product_media_job", { p_seconds: seconds });
      if (!Array.isArray(result) || result.length > 1) throw new MediaJobPortError();
      if (result.length === 0) return null;
      if (!validJob(result[0])) throw new MediaJobPortError();
      return result[0];
    },
    async finish({ id, token, receipt, publicBase } = {}) {
      if (!UUID.test(id) || !UUID.test(token) || !PUBLIC_BASE.test(publicBase) || !validReceipt(receipt)) throw new MediaJobPortError();
      let serialized;
      try { serialized = JSON.stringify(receipt); } catch { throw new MediaJobPortError(); }
      if (!serialized || Buffer.byteLength(serialized) > 8192) throw new MediaJobPortError();
      const result = await rpc("finish_product_media_job", { p_id: id, p_token: token, p_receipt: receipt, p_base: publicBase });
      if (result !== id) throw new MediaJobPortError();
      return result;
    },
    async fail({ id, token, retry } = {}) {
      if (!UUID.test(id) || !UUID.test(token) || typeof retry !== "boolean") throw new MediaJobPortError();
      const result = await rpc("fail_product_media_job", { p_id: id, p_token: token, p_retry: retry });
      if (!result || typeof result !== "object" || Array.isArray(result) || result.id !== id
        || !["ready", "failed"].includes(result.state) || result.lease_token !== null) throw new MediaJobPortError();
      return result;
    },
  };
}
