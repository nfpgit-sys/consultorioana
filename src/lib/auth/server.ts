import "server-only";
import { cookies, headers } from "next/headers";
import { getAuthConfig } from "@/lib/config";
import type { ActionContext, Source } from "@/lib/services/context";
import { ACTOR_COOKIE, SESSION_COOKIE, sanitizeActorName, verifySessionToken } from "./session";

export class UnauthorizedError extends Error {
  constructor() {
    super("Tu sesión no es válida o expiró. Volvé a ingresar con la clave del consultorio.");
    this.name = "UnauthorizedError";
  }
}

/** Verificación de sesión en el servidor (además del proxy), para rutas de API y acciones. */
export async function isAuthenticated(): Promise<boolean> {
  const cfg = getAuthConfig();
  if (cfg.mode === "abierto-local") return true;
  if (cfg.mode === "sin-configurar") return false;
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value, { clave: cfg.clave, sessionSecret: cfg.sessionSecret });
}

export async function assertAuthenticated(): Promise<void> {
  if (!(await isAuthenticated())) throw new UnauthorizedError();
}

export async function getActorName(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(ACTOR_COOKIE)?.value;
  if (!raw) return null;
  try {
    return sanitizeActorName(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/** Contexto de auditoría para una acción del usuario. */
export async function getActionContext(source: Source = "manual", idempotencyKey?: string | null): Promise<ActionContext> {
  await assertAuthenticated();
  return { source, actor: await getActorName(), idempotencyKey: idempotencyKey ?? null };
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64);
  return (h.get("x-real-ip") ?? "local").slice(0, 64);
}
