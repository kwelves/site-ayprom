// Contract check of the photo queue database functions against the LOCAL Supabase only.
// Usage: node scripts/cloudflare/photo-queue-contract.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedLocalRuntimeEnv } from "../e2e/local-runtime.mjs";

const env = getVerifiedLocalRuntimeEnv();
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const rpc = async (name, args) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Object.assign(new Error(`${name}: ${error.message}`), { code: error.code });
  return data;
};

const { data: product, error: productError } = await db.from("products").select("id").limit(1).single();
assert.ifError(productError);
const draft = randomUUID();
const ids = [];
for (let index = 0; index < 3; index += 1) {
  const claim = await db.rpc("claim_product_image_staging", {
    p_draft_id: draft, p_object_path: `contract/${draft}/${index}.png`, p_content_type: "image/png", p_byte_size: 1000, p_ttl_seconds: 600, p_max_files: 10,
  }).single();
  assert.ifError(claim.error);
  ids.push(claim.data.out_id);
}

try {
  // Queue the photos in a deliberate order (reverse of creation); a second call must not re-queue them.
  const order = [ids[2], ids[0], ids[1]];
  assert.equal(await rpc("queue_product_image_staging", { p_draft: draft, p_ids: order, p_product: product.id, p_mode: "script-webp" }), 3);
  assert.equal(await rpc("queue_product_image_staging", { p_draft: draft, p_ids: order, p_product: product.id, p_mode: "normal" }), 0);
  await assert.rejects(rpc("queue_product_image_staging", { p_draft: draft, p_ids: order, p_product: product.id, p_mode: "bogus" }), /invalid_photo_mode/);
  await assert.rejects(rpc("queue_product_image_staging", { p_draft: draft, p_ids: [], p_product: product.id, p_mode: "normal" }), /invalid_photo_queue_request/);

  // The worker receives them in the admin's order, one at a time, each leased exclusively.
  const first = (await rpc("claim_queued_product_image_staging", { p_lease_seconds: 60 }))[0];
  assert.equal(first.id, ids[2]);
  assert.equal(first.attempts, 1);
  assert.equal(first.queued_photo_mode, "script-webp");
  assert.equal(first.queued_product_id, product.id);
  const second = (await rpc("claim_queued_product_image_staging", { p_lease_seconds: 60 }))[0];
  assert.equal(second.id, ids[0]);

  // A failed attempt with retry frees the job; after three attempts it is marked failed for good.
  assert.equal(await rpc("fail_queued_product_image_staging", { p_id: first.id, p_retry: true }), true);
  const again = (await rpc("claim_queued_product_image_staging", { p_lease_seconds: 60 }))[0];
  assert.equal(again.id, first.id);
  assert.equal(again.attempts, 2);
  await rpc("fail_queued_product_image_staging", { p_id: again.id, p_retry: true });
  const third = (await rpc("claim_queued_product_image_staging", { p_lease_seconds: 60 }))[0];
  assert.equal(third.attempts, 3);
  await rpc("fail_queued_product_image_staging", { p_id: third.id, p_retry: true });
  const { data: failedRow } = await db.from("product_image_staging").select("failed_at, lease_until").eq("id", first.id).single();
  assert.ok(failedRow.failed_at, "third failure must be final");
  assert.equal(failedRow.lease_until, null);

  // Finalised rows leave the queue. Nothing else is waiting except the still-leased second job and the last one.
  await rpc("finalize_product_image_staging", { p_id: second.id });
  const rest = await rpc("claim_queued_product_image_staging", { p_lease_seconds: 60 });
  assert.equal(rest[0].id, ids[1]);
  assert.deepEqual(await rpc("claim_queued_product_image_staging", { p_lease_seconds: 60 }), []);

  // Queued photos survive the abandoned-file cleanup for 48 hours.
  const abandoned = await rpc("list_abandoned_product_image_staging", { p_limit: 100 });
  assert.ok(!abandoned.some((row) => ids.includes(row.out_id)), "queued photos must not be listed as abandoned");
  console.log("photo queue contract: ok");
} finally {
  await rpc("release_product_image_staging", { p_ids: ids });
}
