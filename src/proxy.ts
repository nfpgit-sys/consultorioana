import { type NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/config";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/ingresar", "/api/salud"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Protege toda la aplicación con la clave del consultorio.
 * En desarrollo local sin clave configurada se permite el acceso (con un aviso en la interfaz).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cfg = getAuthConfig();
  if (cfg.mode === "abierto-local") return NextResponse.next();

  const authenticated =
    cfg.mode === "clave" &&
    (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, { clave: cfg.clave, sessionSecret: cfg.sessionSecret }));
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Necesitás ingresar con la clave del consultorio.", code: "no_autorizado" },
      { status: 401 },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = "/ingresar";
  url.search = pathname !== "/" ? `?siguiente=${encodeURIComponent(pathname + search)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt).*)"],
};
