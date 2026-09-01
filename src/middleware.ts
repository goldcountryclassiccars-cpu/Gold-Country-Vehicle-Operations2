import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/integration", "/api/health"];

/**
 * Lightweight gate: redirects requests without a session cookie to /login.
 * This is a UX convenience only — real authentication + authorization run
 * server-side on every page and route via getSessionUser()/requirePermission().
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.includes(".")) return NextResponse.next();

  const hasCookie = request.cookies.has("gccc_session");
  if (!hasCookie && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
