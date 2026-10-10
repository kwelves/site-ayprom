import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  withSentryConfig: <T>(config: T) => config,
}));

const loadImageConfig = async (staticBuildFlag: string | undefined) => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "https://media.example.test");
  vi.stubEnv("AYPROM_STATIC_BUILD", staticBuildFlag);

  const { default: nextConfig } = await import("../next.config");
  return nextConfig.images;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Next image delivery for the external static build", () => {
  it("serves source URLs directly when AYPROM_STATIC_BUILD=1", async () => {
    const images = await loadImageConfig("1");
    expect(images?.unoptimized).toBe(true);
  });

  it.each([undefined, "0", "true"])(
    "keeps the legacy image optimizer for flag %s",
    async (flag) => {
      const images = await loadImageConfig(flag);
      expect(images?.unoptimized).toBe(false);
    },
  );

  it("retains Supabase and R2 image origins in static-build mode", async () => {
    const images = await loadImageConfig("1");
    expect(images?.remotePatterns).toEqual([
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "media.example.test",
        port: undefined,
        pathname: "/**",
      },
    ]);
  });
});
