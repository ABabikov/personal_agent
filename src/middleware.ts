import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SITE_AUTH_COOKIE,
  verifySessionToken,
  isSiteAuthConfigured,
} from "@/lib/auth/site-session";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout"
  );
}

export async function middleware(request: NextRequest) {
  if (!isSiteAuthConfigured()) {
    return NextResponse.next();
  }

  const secret = process.env.SITE_AUTH_SECRET!.trim();
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SITE_AUTH_COOKIE)?.value;
  const ok = await verifySessionToken(secret, token);
  if (ok) {
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
