import { describe, expect, it } from "vitest";

const REQUEST_URL = "https://www.ayprom-gidravlika.kg/api/admin/login";

function form(body: string, headers: Record<string, string> = {}) {
  return new Request(REQUEST_URL, {
    method: "POST",
    headers: {
      origin: "https://www.ayprom-gidravlika.kg",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      ...headers,
    },
    body,
  });
}

describe("Worker admin request boundary", () => {
  it("accepts one unmodified password from a same-origin form", async () => {
    const { readLoginRequest, hasSameOrigin } = await import("@/cloudflare/admin/request");
    const request = form("password=a%2Bb%20c");
    expect(hasSameOrigin(request)).toBe(true);
    expect(await readLoginRequest(request)).toEqual({ password: "a+b c" });
  });

  it("rejects missing and foreign origins", async () => {
    const { hasSameOrigin } = await import("@/cloudflare/admin/request");
    expect(hasSameOrigin(form("password=x", { origin: "https://attacker.example" }))).toBe(false);
    expect(hasSameOrigin(form("password=x", { origin: "null" }))).toBe(false);
    expect(hasSameOrigin(form("password=x", { origin: "" }))).toBe(false);
  });

  it("rejects methods and body types other than form POST", async () => {
    const { readLoginRequest } = await import("@/cloudflare/admin/request");
    expect(await readLoginRequest(new Request(REQUEST_URL, { method: "GET" }))).toBeNull();
    expect(await readLoginRequest(form("password=x", { "content-type": "application/json" }))).toBeNull();
    expect(await readLoginRequest(form("password=x", { "content-type": "text/plain" }))).toBeNull();
  });

  it("rejects absent, duplicated, and additional form fields", async () => {
    const { readLoginRequest } = await import("@/cloudflare/admin/request");
    expect(await readLoginRequest(form("other=x"))).toBeNull();
    expect(await readLoginRequest(form("password=x&password=y"))).toBeNull();
    expect(await readLoginRequest(form("password=x&admin=true"))).toBeNull();
  });

  it("rejects empty password and a password larger than 1 KiB", async () => {
    const { readLoginRequest } = await import("@/cloudflare/admin/request");
    expect(await readLoginRequest(form("password="))).toBeNull();
    expect(await readLoginRequest(form(`password=${"x".repeat(1025)}`))).toBeNull();
    expect(await readLoginRequest(form(`password=${"я".repeat(513)}`))).toBeNull();
  });

  it("stops reading a streamed body after the 4 KiB boundary", async () => {
    const { readLoginRequest } = await import("@/cloudflare/admin/request");
    let streamed = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        streamed += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
        if (streamed > 10) controller.close();
      },
    });
    const request = new Request(REQUEST_URL, {
      method: "POST",
      headers: { origin: new URL(REQUEST_URL).origin, "content-type": "application/x-www-form-urlencoded" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(await readLoginRequest(request)).toBeNull();
    expect(streamed).toBeLessThan(11);
  });

  it("extracts one session cookie but rejects duplicates and malformed values", async () => {
    const { readSessionCookie } = await import("@/cloudflare/admin/request");
    expect(readSessionCookie("other=ok; admin_session=abc.DEF")).toBe("abc.DEF");
    expect(readSessionCookie("admin_session=one; admin_session=two")).toBeNull();
    expect(readSessionCookie("admin_session=bad%0Avalue")).toBeNull();
    expect(readSessionCookie("other=ok")).toBeNull();
  });
});
