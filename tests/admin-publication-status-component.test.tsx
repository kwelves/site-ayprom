// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicationStatus = vi.fn();
const retryPublication = vi.fn();
vi.mock("@/lib/admin/actions", () => ({
  fetchPublicationStatus: () => fetchPublicationStatus(),
  retryPublication: () => retryPublication(),
}));

import { AdminPublicationStatus } from "@/components/admin/AdminPublicationStatus";

beforeEach(() => {
  fetchPublicationStatus.mockReset();
  retryPublication.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("AdminPublicationStatus", () => {
  it("makes no request at all in the Next.js admin, where the badge is not built in", () => {
    const { container } = render(<AdminPublicationStatus />);
    expect(fetchPublicationStatus).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("asks for the status once and shows it where the Cloudflare admin switches the badge on", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_CLOUDFLARE", "on");
    fetchPublicationStatus.mockResolvedValue({ enabled: true, state: "published" });
    const { findByText } = render(<AdminPublicationStatus />);
    expect(await findByText("Опубликовано")).toBeTruthy();
    await waitFor(() => expect(fetchPublicationStatus).toHaveBeenCalledTimes(1));
  });
});
