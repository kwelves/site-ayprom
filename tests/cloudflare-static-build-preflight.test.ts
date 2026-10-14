import { describe, expect, it } from "vitest";
import * as staticBuild from "@/cloudflare/static-build";
import {
  validateStaticBuildPreflight,
  type StaticBuildPreflightInput,
} from "@/cloudflare/static-build/preflight";

const validInput = (): StaticBuildPreflightInput => ({
  sourceMode: "local-snapshot",
  release: true,
  repoRoot: "C:\\repo",
  outputRoot: "C:\\repo\\dist\\site",
  gitSha: "ec933e0",
  hasTrackedChanges: false,
  requestedPort: null,
  requestedPortAvailable: true,
  env: {
    AYPROM_STATIC_BUILD: "1",
    NEXT_PUBLIC_SITE_URL: "https://www.ayprom-gidravlika.kg",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
    NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg",
    NEXT_PUBLIC_HERO_MEDIA_SOURCE: "r2",
  },
});

it("exports the complete static build contract surface", () => {
  expect(Object.keys(staticBuild).sort()).toEqual([
    "STATIC_ASSET_MAX_COUNT",
    "STATIC_ASSET_MAX_FILE_BYTES",
    "STATIC_ASSET_WARNING_COUNT",
    "createRouteManifest",
    "derivePublicRoutes",
    "routePathToOutputFile",
    "serializeRouteManifest",
    "validateArtifactPolicy",
    "validateCatalogSnapshot",
    "validateStaticBuildPreflight",
  ]);
});

type RejectedCase = readonly [
  name: string,
  mutate: (input: StaticBuildPreflightInput) => void,
  field: string,
  rule: string,
];

const rejectedCases: RejectedCase[] = [
  [
    "static flag",
    (input) => {
      input.env.AYPROM_STATIC_BUILD = "0";
    },
    "AYPROM_STATIC_BUILD",
    "must_equal_1",
  ],
  [
    "site origin",
    (input) => {
      input.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3001";
    },
    "NEXT_PUBLIC_SITE_URL",
    "release_origin_mismatch",
  ],
  [
    "site path",
    (input) => {
      input.env.NEXT_PUBLIC_SITE_URL = "https://www.ayprom-gidravlika.kg/catalog";
    },
    "NEXT_PUBLIC_SITE_URL",
    "origin_only_required",
  ],
  [
    "media origin",
    (input) => {
      input.env.NEXT_PUBLIC_MEDIA_BASE_URL = "https://example.r2.dev";
    },
    "NEXT_PUBLIC_MEDIA_BASE_URL",
    "release_origin_mismatch",
  ],
  [
    "hero source",
    (input) => {
      input.env.NEXT_PUBLIC_HERO_MEDIA_SOURCE = "supabase";
    },
    "NEXT_PUBLIC_HERO_MEDIA_SOURCE",
    "must_equal_r2",
  ],
  [
    "remote Supabase",
    (input) => {
      input.env.NEXT_PUBLIC_SUPABASE_URL = "https://prod.supabase.co";
    },
    "NEXT_PUBLIC_SUPABASE_URL",
    "local_snapshot_requires_loopback",
  ],
  [
    "secret key",
    (input) => {
      input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_do_not_echo";
    },
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "secret_key_forbidden",
  ],
  [
    "tracked changes",
    (input) => {
      input.hasTrackedChanges = true;
    },
    "git",
    "tracked_changes_forbidden",
  ],
  [
    "bad SHA",
    (input) => {
      input.gitSha = "not-a-sha";
    },
    "gitSha",
    "invalid_sha",
  ],
  [
    "occupied port",
    (input) => {
      input.requestedPort = 3001;
      input.requestedPortAvailable = false;
    },
    "requestedPort",
    "port_unavailable",
  ],
];

describe("static build preflight", () => {
  it("accepts a separate local data source and non-local browser binding for a diagnostic build", () => {
    const input = validInput();
    input.release = false;
    input.env.NEXT_PUBLIC_SUPABASE_URL = "https://static-build.invalid";
    input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_diagnostic";
    input.env.AYPROM_STATIC_BUILD_SUPABASE_URL = "http://127.0.0.1:54321";
    input.env.AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_local_test";
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: true,
      value: { supabaseOrigin: "http://127.0.0.1:54321", supabasePublishableKey: "sb_publishable_local_test" },
    });
  });

  it("rejects a remote override source even with valid browser bindings", () => {
    const input = validInput();
    input.release = false;
    input.env.NEXT_PUBLIC_SUPABASE_URL = "https://static-build.invalid";
    input.env.AYPROM_STATIC_BUILD_SUPABASE_URL = "https://example.supabase.co";
    input.env.AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_local_test";
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false, issues: expect.arrayContaining([
        { field: "AYPROM_STATIC_BUILD_SUPABASE_URL", rule: "local_snapshot_requires_loopback" },
      ]),
    });
  });

  it("accepts the exact releasable local-snapshot boundary", () => {
    expect(validateStaticBuildPreflight(validInput())).toEqual({
      ok: true,
      value: expect.objectContaining({
        sourceMode: "local-snapshot",
        siteOrigin: "https://www.ayprom-gidravlika.kg",
        mediaOrigin: "https://media.ayprom-gidravlika.kg",
        supabaseOrigin: "http://127.0.0.1:54321",
        outputRoot: "C:\\repo\\dist\\site",
      }),
    });
  });

  it("accepts fixture mode without Supabase settings", () => {
    const input = validInput();
    input.sourceMode = "fixture";
    input.release = false;
    delete input.env.NEXT_PUBLIC_SUPABASE_URL;
    delete input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(validateStaticBuildPreflight(input)).toEqual({
      ok: true,
      value: expect.objectContaining({
        sourceMode: "fixture",
        supabaseOrigin: null,
        supabasePublishableKey: null,
      }),
    });
  });

  it("rejects localhost as the public site URL outside release mode", () => {
    const input = validInput();
    input.release = false;
    input.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3001";

    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "NEXT_PUBLIC_SITE_URL", rule: "localhost_forbidden" },
      ]),
    });
  });

  it.each(rejectedCases)(
    "rejects %s without exposing values",
    (_name, mutate, field, rule) => {
      const input = validInput();
      mutate(input);
      const result = validateStaticBuildPreflight(input);

      expect(result).toEqual({
        ok: false,
        code: "preflight_failed",
        issues: expect.arrayContaining([{ field, rule }]),
      });
      expect(JSON.stringify(result)).not.toContain("do_not_echo");
    },
  );

  it.each([
    "C:\\repo\\dist-escape\\site",
    "C:/repo/elsewhere/site",
    "C:\\repo\\dist\\..\\outside",
  ])("rejects output outside the real dist boundary: %s", (outputRoot) => {
    const input = validInput();
    input.outputRoot = outputRoot;
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([{ field: "outputRoot", rule: "outside_dist" }]),
    });
  });

  it("rejects service_role encoded inside a Supabase JWT", () => {
    const input = validInput();
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString(
      "base64url",
    );
    input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = `x.${payload}.y`;
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        {
          field: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          rule: "service_role_forbidden",
        },
      ]),
    });
  });

  it("rejects a malformed JWT-shaped key without throwing or echoing it", () => {
    const input = validInput();
    input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "header.not-base64!.signature";
    const result = validateStaticBuildPreflight(input);
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        {
          field: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          rule: "invalid_publishable_key",
        },
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("not-base64");
  });

  it("rejects a JWT with an empty header or signature", () => {
    const payload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
    for (const key of [`.${payload}.signature`, `header.${payload}.`]) {
      const input = validInput();
      input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
      const result = validateStaticBuildPreflight(input);
      expect(result).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          { field: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", rule: "invalid_publishable_key" },
        ]),
      });
      expect(JSON.stringify(result)).not.toContain(key);
    }
  });

  it("rejects revisioned-live until revision support exists", () => {
    const input = validInput();
    input.sourceMode = "revisioned-live";
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "sourceMode", rule: "live_mode_disabled" },
      ]),
    });
  });

  it("rejects a releasable build from synthetic fixture data", () => {
    const input = validInput();
    input.sourceMode = "fixture";
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "sourceMode", rule: "fixture_not_releasable" },
      ]),
    });
  });

  it("keeps a UNC output path within the same repository share", () => {
    const input = validInput();
    input.repoRoot = "\\\\server\\share\\repo";
    input.outputRoot = "\\\\server\\share\\repo\\dist\\site";
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: true,
      value: {
        repoRoot: "\\\\server\\share\\repo",
        outputRoot: "\\\\server\\share\\repo\\dist\\site",
      },
    });
  });
});
