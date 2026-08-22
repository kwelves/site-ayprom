import { describe, expect, it } from "vitest";
import {
  applyAlterTableColumnChanges,
  extractCreatedPublicTables,
} from "../scripts/schema-migration-parser.mjs";

describe("schema migration parser", () => {
  it("учитывает все колонки в одном ALTER TABLE и последующий DROP", () => {
    const tables = new Map([["products", new Set(["id", "legacy"])]]);
    const sql = `
      ALTER TABLE "public"."products"
        ADD COLUMN "meta_title" text,
        ADD COLUMN "meta_description" text,
        ADD CONSTRAINT "title_length" CHECK (length("meta_title") < 70);
      ALTER TABLE ONLY public.products DROP COLUMN IF EXISTS legacy;
    `;

    applyAlterTableColumnChanges(sql, tables);

    expect([...tables.get("products")!].sort()).toEqual(["id", "meta_description", "meta_title"]);
  });

  it("извлекает колонки декларативной CREATE TABLE с ограничениями", () => {
    const tables = extractCreatedPublicTables(`
      CREATE TABLE IF NOT EXISTS "public"."admin_auth_events" (
        "id" bigint NOT NULL,
        "scope" text NOT NULL,
        CONSTRAINT "scope_check" CHECK (("scope" = 'login'))
      );
    `);

    expect([...tables.get("admin_auth_events")!]).toEqual(["id", "scope"]);
  });
});
