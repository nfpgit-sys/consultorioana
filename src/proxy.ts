import { type NextRequest, NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/config";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/ingresar", "/api/salud"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Política de seguridad de contenido: solo se ejecutan los scripts de la propia app que llevan
 * el nonce de este pedido ('strict-dynamic' habilita los que esos cargan). Los estilos en línea
 * se permiten porque la interfaz usa atributos style (anchos de barras, por ejemplo).
 */
export function buildCsp(nonce: string, https: boolean): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * Protege toda la aplicación con la clave del consultorio.
 * En desarrollo local sin clave configurada se permite el acceso (con un aviso en la interfaz).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = buildCsp(nonce, https);
  const withCsp = <T extends NextResponse>(response: T): T => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  const next = () => {
    // Next.js lee el nonce de este encabezado del pedido y lo aplica a sus scripts.
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return withCsp(NextResponse.next({ request: { headers } }));
  };

  if (isPublic(pathname)) return next();

  const cfg = getAuthConfig();
  if (cfg.mode === "abierto-local") return next();

  const authenticated =
    cfg.mode === "clave" &&
    (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, { clave: cfg.clave, sessionSecret: cfg.sessionSecret }));
  if (authenticated) return next();

  if (pathname.startsWith("/api/")) {
    return withCsp(
      NextResponse.json({ error: "Necesitás ingresar con la clave del consultorio.", code: "no_autorizado" }, { status: 401 }),
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = "/ingresar";
  url.search = pathname !== "/" ? `?siguiente=${encodeURIComponent(pathname + search)}` : "";
  return withCsp(NextResponse.redirect(url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt).*)"],
};
