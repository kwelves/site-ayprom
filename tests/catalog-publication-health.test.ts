import { describe, expect, it, vi } from "vitest";
import { activeCatalogReaderIfEnabled } from "@/lib/catalog-publication-reader";
import { createClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/health/route";

vi.mock("@/lib/catalog-publication-reader", () => ({ activeCatalogReaderIfEnabled: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("legacy health for a published catalog", () => {
  it("checks the active release, not editable categories", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("source denied"));
    vi.mocked(activeCatalogReaderIfEnabled).mockResolvedValue({
      list: vi.fn().mockResolvedValue([]), get: vi.fn(),
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("reports an unavailable release as unhealthy", async () => {
    vi.mocked(activeCatalogReaderIfEnabled).mockRejectedValue(new Error("release unavailable"));
    const response = await GET();
    expect(response.status).toBe(503);
  });
});
