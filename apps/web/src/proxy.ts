import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "syncup_session";

export function proxy(request: NextRequest) {
  const hasSessionCookie = Boolean(request.cookies.get(COOKIE_NAME)?.value);
  if (!hasSessionCookie) {
    const login = new URL("/", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/workspaces/:path*", "/workspace/:path*"]
};
