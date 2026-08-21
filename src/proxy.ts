import { NextResponse, type NextRequest } from "next/server";
import {
  createSessionToken,
  getSessionPayload,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
  SESSION_REFRESH_THRESHOLD_SECONDS,
} from "@/lib/admin/session";
import { getAdminCredentialVersion } from "@/lib/admin/credentials";

export const config = {
  matcher: ["/admin/:path*"],
};

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin/login") {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const payload = await getSessionPayload(token);
  if (payload) {
    try {
      const credentialVersion = await getAdminCredentialVersion();
      if (payload.credentialVersion === credentialVersion) {
        const response = NextResponse.next();
        const remainingSeconds = Math.floor((payload.exp - Date.now()) / 1000);
        if (remainingSeconds < SESSION_REFRESH_THRESHOLD_SECONDS) {
          response.cookies.set(
            SESSION_COOKIE_NAME,
            await createSessionToken({
              originalIssuedAt: payload.iat,
              credentialVersion: payload.credentialVersion,
            }),
            {
              httpOnly: true,
              secure: request.nextUrl.protocol === "https:",
              sameSite: "lax",
              path: "/",
              maxAge: SESSION_DURATION_SECONDS,
            },
          );
        }
        return response;
      }
    } catch {
      const response = NextResponse.redirect(new URL("/admin/login?session=unavailable", request.url));
      response.cookies.delete(SESSION_COOKIE_NAME);
      return response;
    }

    const response = NextResponse.redirect(new URL("/admin/login?session=expired", request.url));
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  return NextResponse.redirect(new URL("/admin/login", request.url));
}
