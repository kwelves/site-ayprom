import { describe, expect, it } from "vitest";
import { ADMIN_TARGETS, buildAdminDeployment } from "../scripts/cloudflare/admin-targets.mjs";

const secretValues = {
  SUPABASE_SECRET_KEY: "sb_secret_unit_test_value_0123456789",
  ADMIN_SESSION_SECRET: "s".repeat(64),
  ADMIN_PASSWORD: "unit-test-password-123",
  GITHUB_DISPATCH_TOKEN: "ghp_unit_test_token_0123456789",
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_ACCESS_KEY_ID: "r2accesskeyid0123456789",
  R2_SECRET_ACCESS_KEY: "r2secretaccesskey0123456789abcdef",
};
const productionInput = {
  target: "production",
  secrets: secretValues,
  publishableKey: "sb_publishable_unit_test_value",
  dualWriteSupabase: "false",
  confirm: "deploy-production-acyoyvetcyqmwppfenau",
};

describe("admin Worker targets", () => {
  it("describes staging and production, each with its own Worker, database and bucket", () => {
    expect(Object.keys(ADMIN_TARGETS).sort()).toEqual(["production", "staging"]);
    expect(ADMIN_TARGETS.staging.workerName).toBe("ayprom-admin-staging");
    expect(ADMIN_TARGETS.production.workerName).toBe("ayprom-admin");
    expect(ADMIN_TARGETS.production.supabaseUrl).toBe("https://acyoyvetcyqmwppfenau.supabase.co");
    expect(ADMIN_TARGETS.staging.supabaseUrl).not.toBe(ADMIN_TARGETS.production.supabaseUrl);
    expect(JSON.stringify(ADMIN_TARGETS)).not.toMatch(/sb_secret|service_role|eyJ|ghp_/);
  });

  it("builds the production deployment with R2 as the media target and the production media address", () => {
    const { vars, secrets, workerName } = buildAdminDeployment(productionInput);
    expect(workerName).toBe("ayprom-admin");
    expect(vars).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: "https://acyoyvetcyqmwppfenau.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test_value",
      NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg",
      NEXT_PUBLIC_SITE_URL: "https://www.ayprom-gidravlika.kg",
      MEDIA_STORAGE_WRITE_TARGET: "r2",
      MEDIA_STORAGE_JOURNAL_BUCKET: "media-migration-journal",
      MEDIA_STORAGE_RETAIN_OBJECTS: "true",
      MEDIA_STORAGE_DUAL_WRITE_SUPABASE: "false",
      R2_BUCKET_NAME: "ayprom-media-production",
      PHOTO_PROCESSING: "queue",
      WORKFLOW_ENVIRONMENT: "production",
      PHOTO_WORKFLOW_REF: "main",
      PUBLICATION_WORKFLOW_REF: "main",
      NODE_ENV: "production",
    });
    expect(Object.keys(secrets).sort()).toEqual(Object.keys(secretValues).sort());
    // Nothing secret may end up among the plain variables.
    expect(JSON.stringify(vars)).not.toMatch(/unit_test_value_0123456789|unit-test-password|ghp_unit|r2secret/);
  });

  it("refuses production without the explicit confirmation, or with the staging one", () => {
    expect(() => buildAdminDeployment({ ...productionInput, confirm: undefined })).toThrow(/confirm/i);
    expect(() => buildAdminDeployment({ ...productionInput, confirm: "deploy-production-jpmoxtqafgbqihvjhvri" })).toThrow(/confirm/i);
    expect(() => buildAdminDeployment({ ...productionInput, confirm: "yes" })).toThrow(/confirm/i);
  });

  it("refuses an incomplete or weak set of secrets before anything is deployed", () => {
    for (const name of Object.keys(secretValues)) {
      const without = { ...secretValues, [name]: undefined };
      expect(() => buildAdminDeployment({ ...productionInput, secrets: without as never })).toThrow(new RegExp(name));
    }
    expect(() => buildAdminDeployment({ ...productionInput, secrets: { ...secretValues, ADMIN_SESSION_SECRET: "short" } })).toThrow(/ADMIN_SESSION_SECRET/);
    expect(() => buildAdminDeployment({ ...productionInput, secrets: { ...secretValues, ADMIN_PASSWORD: "short" } })).toThrow(/ADMIN_PASSWORD/);
    expect(() => buildAdminDeployment({ ...productionInput, secrets: { ...secretValues, R2_ACCOUNT_ID: "nope" } })).toThrow(/R2_ACCOUNT_ID/);
  });

  it("refuses a publishable key that is not a public key, and a missing dual-write decision", () => {
    expect(() => buildAdminDeployment({ ...productionInput, publishableKey: "sb_secret_oops_value" })).toThrow(/publishable/i);
    expect(() => buildAdminDeployment({ ...productionInput, publishableKey: undefined })).toThrow(/publishable/i);
    expect(() => buildAdminDeployment({ ...productionInput, dualWriteSupabase: undefined })).toThrow(/dual/i);
    expect(() => buildAdminDeployment({ ...productionInput, dualWriteSupabase: "maybe" })).toThrow(/dual/i);
  });

  it("builds the staging deployment without R2 and without any confirmation", () => {
    const { vars, secrets } = buildAdminDeployment({
      target: "staging",
      secrets: { SUPABASE_SECRET_KEY: secretValues.SUPABASE_SECRET_KEY, ADMIN_SESSION_SECRET: secretValues.ADMIN_SESSION_SECRET, ADMIN_PASSWORD: secretValues.ADMIN_PASSWORD, GITHUB_DISPATCH_TOKEN: secretValues.GITHUB_DISPATCH_TOKEN },
    });
    expect(vars).toMatchObject({ WORKFLOW_ENVIRONMENT: "staging", NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg", PHOTO_PROCESSING: "queue" });
    expect(vars).not.toHaveProperty("MEDIA_STORAGE_WRITE_TARGET");
    expect(Object.keys(secrets)).not.toContain("R2_SECRET_ACCESS_KEY");
  });

  it("refuses an unknown target", () => {
    expect(() => buildAdminDeployment({ ...productionInput, target: "prod" })).toThrow(/target/i);
  });
});
