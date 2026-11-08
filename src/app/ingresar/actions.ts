"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getClientIp } from "@/lib/auth/server";
import { checkLoginAllowed, recordLoginAttempt } from "@/lib/auth/rate-limit";
import {
  ACTOR_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  claveMatches,
  createSessionToken,
  sanitizeActorName,
} from "@/lib/auth/session";
import { getAuthConfig, isProductionRuntime } from "@/lib/config";

export interface LoginState {
  error?: string;
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Solo rutas internas (evita redirecciones abiertas).
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/ingresar") ? next : "/";
}

export async function ingresar(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const cfg = getAuthConfig();
  if (cfg.mode === "sin-configurar") {
    return { error: "Falta configurar la clave del consultorio en el servidor (CLAVE_CONSULTORIO)." };
  }
  const next = safeNext(formData.get("siguiente"));
  const store = await cookies();
  const actor = sanitizeActorName(String(formData.get("nombre") ?? ""));
  const cookieOpts = {
    httpOnly: true,
    secure: isProductionRuntime(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };

  if (cfg.mode === "clave") {
    const ip = await getClientIp();
    const blocked = await checkLoginAllowed(ip);
    if (blocked) return { error: blocked };
    const clave = String(formData.get("clave") ?? "");
    if (!clave || !(await claveMatches(clave.trim(), cfg.clave))) {
      await recordLoginAttempt(ip, false);
      // Pequeña demora para desalentar intentos automáticos.
      await new Promise((r) => setTimeout(r, 600));
      return { error: "La clave no es correcta." };
    }
    await recordLoginAttempt(ip, true);
    store.set(SESSION_COOKIE, await createSessionToken({ clave: cfg.clave, sessionSecret: cfg.sessionSecret }), cookieOpts);
  }
  if (actor) store.set(ACTOR_COOKIE, encodeURIComponent(actor), { ...cookieOpts, httpOnly: false });
  else store.delete(ACTOR_COOKIE);
  redirect(next);
}

export async function salir() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/ingresar");
}
