// Read-only look at what the R2 media path needs, on the TEST side only: lists the R2 buckets of the account, shows the
// storage buckets of the STAGING Supabase project, and checks that the Cloudflare token can act as S3 credentials
// (Access Key ID = token id, Secret = SHA-256 of the token) on the TEST bucket. Nothing is written. Secrets are never printed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HeadBucketCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const secretsDir = path.join(os.homedir(), ".ayprom-secrets");
const read = (name) => readFileSync(path.join(secretsDir, name), "utf8").trim();
const ACCOUNT = "5542d171bab5b5af3202e36e217f6ef9";
const TEST_BUCKET = "ayprom-media-test";
const token = read("cloudflare-token.txt");
const staging = { url: "https://jpmoxtqafgbqihvjhvri.supabase.co", key: read("supabase-staging-secret-key.txt") };

const api = async (url, headers) => (await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })).json();
const out = {};

const buckets = await api(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets`, { authorization: `Bearer ${token}` });
out.r2Buckets = buckets.success ? buckets.result.buckets.map((bucket) => bucket.name) : `ERR ${JSON.stringify(buckets.errors).slice(0, 120)}`;

const domains = await api(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${TEST_BUCKET}/domains/managed`, { authorization: `Bearer ${token}` });
out.testBucketPublicAccess = domains.success ? domains.result : `ERR ${JSON.stringify(domains.errors).slice(0, 120)}`;

const storage = await api(`${staging.url}/storage/v1/bucket`, { apikey: staging.key, authorization: `Bearer ${staging.key}` });
out.stagingStorageBuckets = Array.isArray(storage) ? storage.map((bucket) => `${bucket.name}${bucket.public ? " (public)" : " (private)"}`) : `ERR ${JSON.stringify(storage).slice(0, 120)}`;

const verify = await api("https://api.cloudflare.com/client/v4/user/tokens/verify", { authorization: `Bearer ${token}` });
if (verify.success) {
  const s3 = new S3Client({ region: "auto", endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: verify.result.id, secretAccessKey: createHash("sha256").update(token).digest("hex") } });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: TEST_BUCKET }));
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: TEST_BUCKET, MaxKeys: 5 }));
    out.s3WithTokenOnTestBucket = `works; ${listed.KeyCount ?? 0} object(s) in the first page`;
  } catch (error) { out.s3WithTokenOnTestBucket = `failed: ${error.name}`; }
}
console.log(JSON.stringify(out, null, 2));
