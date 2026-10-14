import { describe, expect, it } from "vitest";
import { createSupabaseAdminPorts } from "@/cloudflare/admin/supabase-ports";

const bindings = {
  SUPABASE_URL: "http://127.0.0.1:55421", SUPABASE_PUBLISHABLE_KEY: "test-public",
  ADMIN_SUPABASE_KEY: "test-private", ADMIN_AUTH_EMAIL: "admin@example.invalid", ADMIN_AUTH_USER_ID: "test-user",
};
const operations = ["reserve", "finish", "verifyPassword", "credentialVersion"] as const;
function call(ports: ReturnType<typeof createSupabaseAdminPorts>, operation: typeof operations[number]) {
  if (operation === "reserve") return ports.reserve("a".repeat(64));
  if (operation === "finish") return ports.finish("test-reservation", false);
  if (operation === "verifyPassword") return ports.verifyPassword("test-password");
  return ports.credentialVersion();
}
function payload(operation: typeof operations[number], padding = "") {
  if (operation === "reserve") return [{ out_allowed: true, out_retry_after: 0, out_reservation_id: "test-reservation", padding }];
  if (operation === "finish") return 0;
  if (operation === "verifyPassword") return { user: { id: bindings.ADMIN_AUTH_USER_ID }, access_token: "test-token", refresh_token: "test-refresh", padding };
  return [{ session_version: 1, padding }];
}

describe("bounded auth backend HTTP", () => {
  it.each(operations)("sets manual redirect and a deadline signal for %s", async (operation) => {
    let options: RequestInit | undefined;
    const ports = createSupabaseAdminPorts(bindings, async (_, init) => {
      options = init;
      return Response.json(payload(operation));
    });
    await call(ports, operation);
    expect(options?.redirect).toBe("manual");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.cache).toBe("no-store");
  });

  it.each(operations)("rejects oversized JSON and cancels its stream for %s", async (operation) => {
    let cancelled = false;
    const text = JSON.stringify(payload(operation, "x".repeat(65_536))) + (operation === "finish" ? " ".repeat(65_536) : "");
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(text)); },
      cancel() { cancelled = true; },
    });
    const ports = createSupabaseAdminPorts(bindings, async () => new Response(body));
    // An oversized open stream must be cancelled without waiting for EOF.
    // This watchdog distinguishes missing limits from a Vitest test timeout.
    const settled = call(ports, operation);
    const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error("unbounded_read")), 100));
    await expect(Promise.race([settled, deadline])).rejects.toThrow(/Admin (protection|verifier) unavailable/);
    expect(cancelled).toBe(true);
  });

  it.each(operations)("rejects backend redirects without parsing a success body for %s", async (operation) => {
    const ports = createSupabaseAdminPorts(bindings, async () => Response.json(payload(operation), {
      status: 302, headers: { location: "https://other.example.invalid/secret-sink" },
    }));
    await expect(call(ports, operation)).rejects.toThrow(/Admin (protection|verifier) unavailable/);
  });

  it("rejects a backend URL containing credentials before invoking fetch", async () => {
    let calls = 0;
    const ports = createSupabaseAdminPorts({ ...bindings, SUPABASE_URL: "https://user:password@db.example.invalid" }, async () => {
      calls++;
      return Response.json(0);
    });
    await expect(ports.finish("test-reservation", false)).rejects.toThrow("Admin protection unavailable");
    expect(calls).toBe(0);
  });
});
