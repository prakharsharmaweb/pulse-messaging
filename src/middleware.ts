import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE = process.env.AUTH_COOKIE ?? "rtm_session";

/**
 * Lightweight gate: presence of a session cookie. Full cryptographic
 * verification + authorization happens in every route handler / socket handler
 * (see src/lib/auth.ts) — this only handles page redirects for UX.
 */
export function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get(AUTH_COOKIE)?.value);
  const { pathname } = req.nextUrl;
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (!hasSession && pathname.startsWith("/chat")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasSession && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/chat/:path*", "/login", "/register"],
};
