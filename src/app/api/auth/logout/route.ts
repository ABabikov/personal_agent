import { NextResponse } from "next/server";
import { SITE_AUTH_COOKIE } from "@/lib/auth/site-session";

export async function POST(_req: Request) {
  const res = NextResponse.json({ ok: true });
  clearAuthCookie(res);
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = `${url.origin}/login`;
  const res = NextResponse.redirect(target);
  clearAuthCookie(res);
  return res;
}

function clearAuthCookie(res: NextResponse) {
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SITE_AUTH_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
