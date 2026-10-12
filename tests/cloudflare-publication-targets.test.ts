import { describe, expect, it } from "vitest";
import { resolvePublicationTarget, TARGETS } from "../scripts/cloudflare/publication-targets.mjs";

const staging = {
  PUBLICATION_TARGET: "staging",
  SUPABASE_URL: "https://jpmoxtqafgbqihvjhvri.supabase.co",
  WORKER_NAME: "ayprom-publication-staging",
};
const production = {
  PUBLICATION_TARGET: "production",
  SUPABASE_URL: "https://acyoyvetcyqmwppfenau.supabase.co",
  WORKER_NAME: "ayprom-public",
  PUBLICATION_CONFIRM: "publish-production-acyoyvetcyqmwppfenau",
};

describe("publication targets", () => {
  it("accepts the staging project with the staging Worker", () => {
    expect(resolvePublicationTarget(staging)).toMatchObject({ name: "staging", workerName: "ayprom-publication-staging" });
  });

  it("accepts the production project with the production Worker only after the explicit confirmation", () => {
    expect(resolvePublicationTarget(production)).toMatchObject({ name: "production", workerName: "ayprom-public" });
    expect(() => resolvePublicationTarget({ ...production, PUBLICATION_CONFIRM: undefined })).toThrow(/confirm/i);
    expect(() => resolvePublicationTarget({ ...production, PUBLICATION_CONFIRM: "yes" })).toThrow(/confirm/i);
    expect(() => resolvePublicationTarget({ ...production, PUBLICATION_CONFIRM: "publish-production-jpmoxtqafgbqihvjhvri" })).toThrow(/confirm/i);
  });

  it("refuses a target that is missing or unknown", () => {
    expect(() => resolvePublicationTarget({ ...staging, PUBLICATION_TARGET: undefined })).toThrow(/PUBLICATION_TARGET/);
    expect(() => resolvePublicationTarget({ ...staging, PUBLICATION_TARGET: "prod" })).toThrow(/PUBLICATION_TARGET/);
  });

  it("never lets one project's data go to the other project's Worker", () => {
    expect(() => resolvePublicationTarget({ ...staging, SUPABASE_URL: production.SUPABASE_URL })).toThrow(/database/i);
    expect(() => resolvePublicationTarget({ ...production, SUPABASE_URL: staging.SUPABASE_URL })).toThrow(/database/i);
    expect(() => resolvePublicationTarget({ ...staging, WORKER_NAME: "ayprom-public" })).toThrow(/worker/i);
    expect(() => resolvePublicationTarget({ ...production, WORKER_NAME: "ayprom-publication-staging" })).toThrow(/worker/i);
  });

  it("refuses look-alike database addresses", () => {
    for (const url of [
      "http://jpmoxtqafgbqihvjhvri.supabase.co",
      "https://jpmoxtqafgbqihvjhvri.supabase.co.evil.example",
      "https://evil.example/jpmoxtqafgbqihvjhvri.supabase.co",
      "https://user@jpmoxtqafgbqihvjhvri.supabase.co",
    ]) {
      expect(() => resolvePublicationTarget({ ...staging, SUPABASE_URL: url })).toThrow();
    }
  });

  it("describes both targets without secrets", () => {
    expect(Object.keys(TARGETS).sort()).toEqual(["production", "staging"]);
    expect(JSON.stringify(TARGETS)).not.toMatch(/sb_secret|service_role|eyJ/);
  });
});
