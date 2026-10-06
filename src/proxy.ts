import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

const PUBLIC = ["/login", "/auth"];

/**
 * Cheap edge gate: send visitors without a session cookie to /login. No network calls here, so
 * navigation isn't slowed down; the browser validates/refreshes the session and the database
 * enforces access (Row Level Security).
 */
export function proxy(request: NextRequest) {
  if (!hasSupabaseEnv) return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (PUBLIC.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next();

  const hasSession = request.cookies.getAll().some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name) && c.value);
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|.*\\.(?:png|svg|jpg|ico|webp)$).*)"],
};
