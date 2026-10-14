import { API_SECURITY_HEADERS } from "../worker-api";
import {
  createSessionCodec,
  SESSION_DURATION_SECONDS,
  SESSION_REFRESH_THRESHOLD_SECONDS,
} from "@/lib/admin/session-codec";
import type { AdminAuthPorts, AdminPasswordProof } from "./contracts";
import { hasSameOrigin, readLoginRequest, readPasswordChangeRequest, readSessionCookie } from "./request";
import { parseAdminReadQuery, renderAdminProducts } from "./products";
import { constantTimePasswordEqual, validateNewAdminPassword } from "@/lib/admin/password-credential";
import { AdminProductMutationError, type ProductMutationFields } from "./product-mutation-ports";
import { isAdminProductSlug } from "./product-detail-reader";
import {
  PRODUCT_EDIT_DISABLED_MESSAGE, productEditValues, readProductEditSubmission, renderProductEditMessage, renderProductEditPage,
} from "./product-edit-form";

const RESPONSE_HEADERS = { ...API_SECURITY_HEADERS, "cache-control": "no-store" };
// Worker-rendered admin HTML: no script, no style, posts only to this origin.
const ADMIN_HTML_HEADERS = {
  ...RESPONSE_HEADERS, "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow",
  "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function adminHtml(body: string, status = 200): Response {
  return new Response(body, { status, headers: ADMIN_HTML_HEADERS });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers(RESPONSE_HEADERS);
  headers.set("location", location);
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function invalidRequest(status: number, allowedMethod?: string): Response {
  const headers = new Headers({ ...RESPONSE_HEADERS, "content-type": "text/plain; charset=utf-8" });
  if (allowedMethod) headers.set("allow", allowedMethod);
  return new Response(status === 405 ? "Method not allowed" : "Bad request", { status, headers });
}

function unavailableResponse(): Response {
  return new Response("Admin page unavailable", {
    status: 503,
    headers: { ...RESPONSE_HEADERS, "content-type": "text/plain; charset=utf-8" },
  });
}

async function readProductJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "") || !request.body) return null;
  const maxBytes = 64 * 1024;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function cookieAttribute(request: Request): string {
  return `; Path=/; HttpOnly; SameSite=Lax${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

function retryLocation(seconds: number): string {
  const retry = Number.isFinite(seconds) ? Math.min(900, Math.max(1, Math.ceil(seconds))) : 900;
  return `/admin/login?error=rate&retry=${retry}`;
}

function parsePasswordProof(proof: unknown): AdminPasswordProof | null {
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)) return null;
  const { valid, credentialVersion } = proof as Record<string, unknown>;
  if (valid === false) return { valid: false };
  if (valid === true && Number.isSafeInteger(credentialVersion) && (credentialVersion as number) >= 1) {
    return { valid: true, credentialVersion: credentialVersion as number };
  }
  return null;
}

async function serveHtmlAsset(ports: AdminAuthPorts, request: Request, assetPath: string): Promise<Response> {
  try {
    const asset = await ports.assets.fetch(new Request(new URL(assetPath, request.url)));
    if (asset.status !== 200 || !(asset.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) {
      return unavailableResponse();
    }
    let body: BodyInit | null = asset.body;
    if (assetPath === "/admin/login.html") {
      const query = new URL(request.url).searchParams;
      let message = "";
      if (query.get("error") === "1") message = "Неверный пароль.";
      else if (query.get("error") === "security") message = "Вход временно недоступен. Попробуйте позже.";
      else if (query.get("error") === "rate") {
        const raw = query.get("retry") ?? "";
        const seconds = /^\d{1,8}$/.test(raw) ? Math.min(900, Math.max(1, Number(raw))) : 900;
        message = `Слишком много попыток. Повторите через ${Math.ceil(seconds / 60)} минут.`;
      } else if (query.get("session") === "expired") message = "Сессия истекла. Войдите снова.";
      else if (query.get("session") === "unavailable") message = "Проверка сессии временно недоступна.";
      else if (query.get("changed") === "1") message = "Пароль изменён. Войдите с новым паролем.";
      body = (await asset.text()).replace("<!-- AUTH_MESSAGE -->", message);
    } else if (assetPath === "/admin/security.html") {
      const error = new URL(request.url).searchParams.get("error");
      const message = error === "1" ? "Текущий пароль указан неверно."
        : error === "same" ? "Новый пароль должен отличаться от текущего."
          : error === "rate" ? "Слишком много попыток. Повторите позже."
            : error === "invalid" ? "Проверьте новый пароль и подтверждение."
              : error === "security" ? "Не удалось изменить пароль. Попробуйте позже." : "";
      body = (await asset.text()).replace("<!-- AUTH_MESSAGE -->", message);
    }
    return new Response(body, {
      status: 200,
      headers: {
        ...API_SECURITY_HEADERS,
        "content-security-policy": "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch {
    return unavailableResponse();
  }
}

async function attemptKey(secret: string, clientIp: string, scope: "login" | "password-change" = "login"): Promise<string> {
  if (!secret || !clientIp) throw new Error("Admin request context unavailable");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${scope}:${clientIp}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * No-JavaScript save of the edit form. Order matters: Origin, then session and
 * its password version, then the write port; the body is parsed only after
 * that and the product is written only through the CAS update port.
 */
async function submitProductEdit(ports: AdminAuthPorts, request: Request, slug: string): Promise<Response> {
  if (!hasSameOrigin(request)) return invalidRequest(400);
  if (!isAdminProductSlug(slug)) return invalidRequest(404);
  const session = await createSessionCodec(ports.secret, ports.now).read(readSessionCookie(request.headers.get("cookie")) ?? undefined);
  if (!session) return redirect("/admin/login");
  let currentVersion: number;
  try { currentVersion = await ports.credentialVersion(); }
  catch { return redirect("/admin/login?session=unavailable", `admin_session=; Max-Age=0${cookieAttribute(request)}`); }
  if (session.credentialVersion !== currentVersion) {
    return redirect("/admin/login?session=expired", `admin_session=; Max-Age=0${cookieAttribute(request)}`);
  }
  if (!ports.updateProduct) return adminHtml(renderProductEditMessage("Сохранение недоступно", PRODUCT_EDIT_DISABLED_MESSAGE), 503);
  const submission = await readProductEditSubmission(request);
  if (!submission) return invalidRequest(400);
  const rerender = (status: number, error: Parameters<typeof renderProductEditPage>[0]["error"]) =>
    adminHtml(renderProductEditPage({ currentSlug: slug, values: submission.values, canSave: true, error }), status);
  if ("message" in submission) return rerender(400, { message: submission.message });
  try {
    await ports.updateProduct({ slug, ...submission.input });
  } catch (error) {
    if (error instanceof AdminProductMutationError && error.code === "conflict") return rerender(409, "conflict");
    if (error instanceof AdminProductMutationError && error.code === "input_invalid") return rerender(400, "invalid");
    console.error(JSON.stringify({ code: "admin_product_edit_unavailable" }));
    return rerender(503, "unavailable");
  }
  return redirect(`/admin/products/${submission.input.newSlug}/edit?saved=1`);
}

export function createAdminHandler(ports: AdminAuthPorts): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const pathname = new URL(request.url).pathname;
    const productApi = pathname === "/api/admin/products";
    const apiError = (status: number) => Response.json({ error: status === 401 ? "unauthorized" : "unavailable" }, { status, headers: RESPONSE_HEADERS });
    if (pathname === "/api/admin/login") {
      if (request.method !== "POST") return invalidRequest(405, "POST");
      if (!hasSameOrigin(request)) return invalidRequest(400);
      const form = await readLoginRequest(request);
      if (!form) return invalidRequest(400);

      let reservation;
      try {
        reservation = await ports.reserve(await attemptKey(ports.secret, ports.clientIp));
      } catch {
        return redirect("/admin/login?error=security");
      }
      if (!reservation.allowed || !reservation.reservationId) {
        return redirect(retryLocation(reservation.retryAfter));
      }

      // With the proof port the password is checked against ONE state read and
      // the session may carry only that state's version; the boolean port is
      // then never used, even after an error (no fallback to a weaker path).
      let valid = false;
      let provenVersion: number | null = null;
      try {
        if (ports.verifyPasswordWithVersion) {
          const parsed = parsePasswordProof(await ports.verifyPasswordWithVersion(form.password));
          if (!parsed) throw new Error("Malformed password proof");
          valid = parsed.valid;
          provenVersion = parsed.valid ? parsed.credentialVersion : null;
        } else {
          valid = await ports.verifyPassword(form.password);
        }
      } catch {
        try {
          await ports.finish(reservation.reservationId, false);
        } catch {
          // A failed reservation finish is also fail-closed; never issue a cookie.
        }
        return redirect("/admin/login?error=security");
      }

      let retryAfter;
      try {
        retryAfter = await ports.finish(reservation.reservationId, valid);
      } catch {
        return redirect("/admin/login?error=security");
      }
      if (retryAfter > 0) return redirect(retryLocation(retryAfter));
      if (!valid) return redirect("/admin/login?error=1");

      try {
        const currentVersion = await ports.credentialVersion();
        if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
          return redirect("/admin/login?error=security");
        }
        // The password was proven for `provenVersion`. If the credential moved on
        // since (verification → finish), a cookie would pair the old password
        // with the new version, so refuse instead.
        if (provenVersion !== null && provenVersion !== currentVersion) {
          return redirect("/admin/login?error=security");
        }
        const credentialVersion = provenVersion ?? currentVersion;
        const token = await createSessionCodec(ports.secret, ports.now).create({ credentialVersion });
        return redirect("/admin", `admin_session=${token}; Max-Age=${SESSION_DURATION_SECONDS}${cookieAttribute(request)}`);
      } catch {
        return redirect("/admin/login?error=security");
      }
    }

    if (pathname === "/api/admin/logout") {
      if (request.method !== "POST") return invalidRequest(405, "POST");
      if (!hasSameOrigin(request)) return invalidRequest(400);
      return redirect("/admin/login", `admin_session=; Max-Age=0${cookieAttribute(request)}`);
    }

    if (pathname === "/api/admin/password") {
      if (request.method !== "POST") return invalidRequest(405, "POST");
      if (!hasSameOrigin(request)) return invalidRequest(400);
      const session = await createSessionCodec(ports.secret, ports.now).read(readSessionCookie(request.headers.get("cookie")) ?? undefined);
      if (!session) return redirect("/admin/login");
      let currentVersion: number;
      try { currentVersion = await ports.credentialVersion(); }
      catch { return redirect("/admin/login?session=unavailable", `admin_session=; Max-Age=0${cookieAttribute(request)}`); }
      if (session.credentialVersion !== currentVersion) {
        return redirect("/admin/login?session=expired", `admin_session=; Max-Age=0${cookieAttribute(request)}`);
      }
      const form = await readPasswordChangeRequest(request);
      if (!form) return invalidRequest(400);
      if (validateNewAdminPassword(form.newPassword, form.confirmPassword)) return redirect("/admin/security?error=invalid");
      if (!ports.verifyPasswordWithVersion || !ports.hashPassword || !ports.replacePasswordHash) {
        return redirect("/admin/security?error=security");
      }

      let reservation;
      try { reservation = await ports.reserve(await attemptKey(ports.secret, ports.clientIp, "password-change"), "password-change"); }
      catch { return redirect("/admin/security?error=security"); }
      if (!reservation.allowed || !reservation.reservationId) return redirect("/admin/security?error=rate");

      let proof: AdminPasswordProof | null;
      try { proof = parsePasswordProof(await ports.verifyPasswordWithVersion(form.currentPassword)); }
      catch { proof = null; }
      if (!proof) {
        try { await ports.finish(reservation.reservationId, false); } catch { /* fail closed */ }
        return redirect("/admin/security?error=security");
      }
      const valid = proof.valid && proof.credentialVersion === session.credentialVersion;
      let retryAfter: number;
      try { retryAfter = await ports.finish(reservation.reservationId, valid); }
      catch { return redirect("/admin/security?error=security"); }
      if (retryAfter > 0) return redirect("/admin/security?error=rate");
      if (!valid) return proof.valid
        ? redirect("/admin/login?session=expired", `admin_session=; Max-Age=0${cookieAttribute(request)}`)
        : redirect("/admin/security?error=1");
      try {
        if (await constantTimePasswordEqual(form.currentPassword, form.newPassword)) return redirect("/admin/security?error=same");
      } catch { return redirect("/admin/security?error=security"); }

      try {
        const hash = await ports.hashPassword(form.newPassword);
        const newVersion = await ports.replacePasswordHash(hash, session.credentialVersion);
        if (newVersion !== session.credentialVersion + 1) return redirect("/admin/security?error=security");
        return redirect("/admin/login?changed=1", `admin_session=; Max-Age=0${cookieAttribute(request)}`);
      } catch { return redirect("/admin/security?error=security"); }
    }

    const editMatch = /^\/api\/admin\/products\/([^/]+)$/.exec(pathname);
    if ((productApi && request.method === "POST") || (editMatch && request.method === "PUT")) {
      if (productApi && !ports.createProduct) return invalidRequest(405, "GET");
      if (editMatch && !ports.updateProduct) return invalidRequest(404);
      if (!hasSameOrigin(request)) return invalidRequest(400);
      if (editMatch && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editMatch[1])) return invalidRequest(400);
      const session = await createSessionCodec(ports.secret, ports.now).read(readSessionCookie(request.headers.get("cookie")) ?? undefined);
      if (!session) return apiError(401);
      let currentVersion: number;
      try { currentVersion = await ports.credentialVersion(); }
      catch { return apiError(503); }
      if (session.credentialVersion !== currentVersion) return apiError(401);
      if (productApi ? !ports.createProduct : !ports.updateProduct) return apiError(503);
      const input = await readProductJson(request);
      if (!input) return invalidRequest(400);
      try {
        if (productApi) {
          const created = await ports.createProduct!(input as unknown as ProductMutationFields);
          return Response.json(created, { status: 201, headers: RESPONSE_HEADERS });
        }
        if (typeof input.newSlug !== "string" || typeof input.expectedUpdatedAt !== "string"
          || !input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)) return invalidRequest(400);
        const updated = await ports.updateProduct!({
          slug: editMatch![1], newSlug: input.newSlug, expectedUpdatedAt: input.expectedUpdatedAt,
          fields: input.fields as ProductMutationFields,
        });
        return Response.json(updated, { headers: RESPONSE_HEADERS });
      } catch (error) {
        if (error instanceof AdminProductMutationError) {
          if (error.code === "input_invalid") return Response.json({ error: "invalid_product" }, { status: 400, headers: RESPONSE_HEADERS });
          if (error.code === "conflict") return Response.json({ error: "conflict" }, { status: 409, headers: RESPONSE_HEADERS });
        }
        return apiError(503);
      }
    }

    if (editMatch && request.method !== "GET") return invalidRequest(405, ports.updateProduct ? "GET, PUT" : "GET");
    const editPage = /^\/admin\/products\/([^/]+)\/edit$/.exec(pathname);
    if (editPage && request.method === "POST") return submitProductEdit(ports, request, editPage[1]);

    if (!productApi && !editMatch && (pathname === "/api/admin" || pathname.startsWith("/api/admin/"))) return invalidRequest(404);

    if (pathname === "/admin/login") {
      if (request.method !== "GET") return invalidRequest(405, "GET");
      return serveHtmlAsset(ports, request, "/admin/login.html");
    }

    if (productApi || editMatch || pathname === "/admin" || pathname.startsWith("/admin/")) {
      const jsonApi = productApi || editMatch !== null;
      // The source filenames are never public routes, even with a session.
      if (pathname === "/admin/index.html" || pathname === "/admin/login.html" || pathname === "/admin/security.html") return invalidRequest(404);
      if (request.method !== "GET") return invalidRequest(405, "GET");
      const rawToken = readSessionCookie(request.headers.get("cookie"));
      const session = await createSessionCodec(ports.secret, ports.now).read(rawToken ?? undefined);
      if (!session) return jsonApi ? apiError(401) : new Response(null, { status: 302, headers: { ...RESPONSE_HEADERS, location: "/admin/login" } });

      let credentialVersion: number;
      try {
        credentialVersion = await ports.credentialVersion();
      } catch {
        console.error(JSON.stringify({ code: "admin_products_unavailable", stage: "credential" }));
        if (jsonApi) return apiError(503);
        const response = new Response(null, { status: 302, headers: { ...RESPONSE_HEADERS, location: "/admin/login?session=unavailable" } });
        response.headers.set("set-cookie", `admin_session=; Max-Age=0${cookieAttribute(request)}`);
        return response;
      }
      if (session.credentialVersion !== credentialVersion) {
        if (jsonApi) return apiError(401);
        const response = new Response(null, { status: 302, headers: { ...RESPONSE_HEADERS, location: "/admin/login?session=expired" } });
        response.headers.set("set-cookie", `admin_session=; Max-Age=0${cookieAttribute(request)}`);
        return response;
      }
      if (pathname !== "/admin" && pathname !== "/admin/products" && pathname !== "/admin/security" && !jsonApi && !editPage) return invalidRequest(404);

      let page: Response;
      const productSlug = (editMatch ?? editPage)?.[1];
      if (productSlug !== undefined) {
        // Session and password version are already proven: only now may a draft be read.
        if (!isAdminProductSlug(productSlug)) return invalidRequest(editMatch ? 400 : 404);
        let product;
        try {
          if (!ports.readProduct) throw new Error("Admin product reader unavailable");
          product = await ports.readProduct(productSlug);
        } catch {
          console.error(JSON.stringify({ code: "admin_product_unavailable", stage: "handler" }));
          return editMatch ? apiError(503) : unavailableResponse();
        }
        if (editMatch) {
          page = product ? Response.json(product, { headers: RESPONSE_HEADERS })
            : Response.json({ error: "not_found" }, { status: 404, headers: RESPONSE_HEADERS });
        } else if (!product) {
          page = adminHtml(renderProductEditMessage("Товар не найден", "Товар с таким адресом не найден: возможно, его переименовали или удалили."), 404);
        } else {
          page = adminHtml(renderProductEditPage({
            currentSlug: productSlug, values: productEditValues(product), canSave: !!ports.updateProduct,
            notice: new URL(request.url).searchParams.get("saved") === "1" ? "saved" : undefined,
            hotspotCount: product.hotspotCount,
          }));
        }
      } else if (productApi || pathname === "/admin/products") {
        let query;
        try { query = parseAdminReadQuery(new URL(request.url).searchParams); }
        catch { return invalidRequest(400); }
        try {
          if (!ports.readProducts) return unavailableResponse();
          const result = await ports.readProducts(query);
          page = productApi ? Response.json(result, { headers: RESPONSE_HEADERS }) : new Response(renderAdminProducts(result, query), {
            headers: { ...RESPONSE_HEADERS, "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow",
              "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
          });
        } catch {
          console.error(JSON.stringify({ code: "admin_products_unavailable", stage: "handler" }));
          return productApi ? apiError(503) : unavailableResponse();
        }
      } else page = await serveHtmlAsset(ports, request, pathname === "/admin/security" ? "/admin/security.html" : "/admin/index.html");
      if (page.status !== 200) return page;
      if ((session.exp - ports.now()) / 1000 < SESSION_REFRESH_THRESHOLD_SECONDS) {
        try {
          const token = await createSessionCodec(ports.secret, ports.now).create({
            originalIssuedAt: session.iat,
            credentialVersion: session.credentialVersion,
          });
          page.headers.set("set-cookie", `admin_session=${token}; Max-Age=${SESSION_DURATION_SECONDS}${cookieAttribute(request)}`);
        } catch {
          return unavailableResponse();
        }
      }
      return page;
    }
    return null;
  };
}
