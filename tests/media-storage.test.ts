import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: unknown) {} }
  return { S3Client: class { send = mocks.send; }, HeadObjectCommand: Command, PutObjectCommand: Command, DeleteObjectsCommand: Command };
});
import { createHash } from "node:crypto";
import { uploadPublicMediaObject, removePublicMediaUrls } from "@/lib/media-storage";

const input = { bucket: "product-images" as const, path: "pump/photo/master.png", body: Buffer.from("validated-file"), contentType: "image/png", allowExisting: true };
const digest = createHash("sha256").update(input.body).digest("hex");
function client(publicJournal = false) {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const storage = { getBucket: vi.fn().mockResolvedValue({ data: { public: publicJournal }, error: null }), from: vi.fn().mockReturnValue({ upload, remove, getPublicUrl: () => ({ data: { publicUrl: "https://project.supabase.co/storage/v1/object/public/product-images/pump/photo/master.png" } }) }) };
  return { supabase: { storage } as unknown as SupabaseClient, storage, upload, remove };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({ MEDIA_STORAGE_WRITE_TARGET: "r2", MEDIA_STORAGE_DUAL_WRITE_SUPABASE: "true", MEDIA_STORAGE_RETAIN_OBJECTS: "true", MEDIA_STORAGE_JOURNAL_BUCKET: "private-journal", R2_ACCOUNT_ID: "test-account", R2_ACCESS_KEY_ID: "test-key", R2_SECRET_ACCESS_KEY: "test-secret", R2_BUCKET_NAME: "test-bucket", NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.example.com", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" })) vi.stubEnv(key, value);
  mocks.send.mockResolvedValue({ ContentLength: input.body.length, Metadata: { sha256: digest } });
});
afterEach(() => vi.unstubAllEnvs());

describe("media publication safety", () => {
  it("publishes only after both copies and the private receipt succeed", async () => {
    const c = client();
    expect(await uploadPublicMediaObject(c.supabase, input)).toBe("https://media.example.com/product-images/pump/photo/master.png");
    expect(c.upload).toHaveBeenCalledTimes(2);
    const receipt = JSON.parse(c.upload.mock.calls[1][1].toString());
    expect(receipt).toMatchObject({ sha256: digest, size: input.body.length });
    expect(receipt.backupUrl).toContain("project.supabase.co");
  });
  it("rejects a public journal before contacting R2", async () => {
    await expect(uploadPublicMediaObject(client(true).supabase, input)).rejects.toThrow("закрытом");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not delete an existing R2 photo when the backup fails on retry", async () => {
    const c = client();
    c.upload.mockResolvedValue({ error: new Error("backup unavailable") });
    await expect(uploadPublicMediaObject(c.supabase, input)).rejects.toThrow("backup unavailable");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(c.remove).not.toHaveBeenCalled();
  });
  it("fails closed if the private receipt cannot be saved", async () => {
    const c = client();
    c.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error("journal unavailable") });
    await expect(uploadPublicMediaObject(c.supabase, input)).rejects.toThrow("journal unavailable");
  });
  it("retains physical objects during the migration window", async () => {
    const c = client();
    await removePublicMediaUrls(c.supabase, "product-images", ["https://media.example.com/product-images/pump/photo/master.png"]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(c.remove).not.toHaveBeenCalled();
  });
  it("keeps Supabase as the default when the switch is unset", async () => {
    vi.stubEnv("MEDIA_STORAGE_WRITE_TARGET", "");
    const c = client();
    expect(await uploadPublicMediaObject(c.supabase, input)).toContain("project.supabase.co");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(c.storage.getBucket).not.toHaveBeenCalled();
  });
});
