import { describe, expect, it } from "vitest";
import {
  assertPublicSupabaseKey,
  assertLocalSupabaseUrl,
  parseSupabaseStatusEnv,
} from "../scripts/cloudflare/postgrest-contract-lib.mjs";

describe("локальный PostgREST contract gate", () => {
  it("разбирает переименованные env-поля Supabase CLI без вывода ключей", () => {
    const values = parseSupabaseStatusEnv([
      'CLOUDFLARE_POSTGREST_URL="http://127.0.0.1:54321"',
      'CLOUDFLARE_POSTGREST_PUBLISHABLE_KEY="sb_publishable_local"',
      "IGNORED line",
    ].join("\n"));

    expect(values.get("CLOUDFLARE_POSTGREST_URL")).toBe(
      "http://127.0.0.1:54321",
    );
    expect(values.get("CLOUDFLARE_POSTGREST_PUBLISHABLE_KEY")).toBe(
      "sb_publishable_local",
    );
  });

  it.each([
    "https://127.0.0.1:54321",
    "http://127.0.0.1:54322",
    "http://catalog.supabase.co:54321",
    "not-a-url",
  ])("отвергает неразрешённый Supabase URL %s", (url) => {
    expect(() => assertLocalSupabaseUrl(url)).toThrow(
      "только на local Supabase http://127.0.0.1:54321",
    );
  });

  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
  ])("разрешает loopback Supabase URL %s", (url) => {
    expect(() => assertLocalSupabaseUrl(url)).not.toThrow();
  });

  it.each([
    "sb_secret_fake16",
    `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`,
  ])("отвергает service-role key без вывода его значения", (key) => {
    expect(() => assertPublicSupabaseKey(key)).toThrow(
      "только публичный Supabase key",
    );
  });

  it.each([
    "sb_publishable_local_key",
    `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`,
  ])("разрешает публичный Supabase key", (key) => {
    expect(() => assertPublicSupabaseKey(key)).not.toThrow();
  });
});
