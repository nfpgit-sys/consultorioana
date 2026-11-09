import "server-only";
import { getDb } from "@/lib/db";
import type { Queryable } from "@/lib/db/types";

/**
 * Límite de intentos de clave.
 *
 * - Un dispositivo de confianza (navegador que ya ingresó antes, con cookie firmada) tiene su
 *   propio límite: sus errores no bloquean a otros dispositivos del consultorio, que suelen
 *   compartir la misma IP, y no cuentan para el límite global.
 * - Los navegadores nuevos tienen límite por IP y uno global (frena intentos distribuidos);
 *   esos límites nunca bloquean a los dispositivos de confianza.
 */
export const WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_DEVICE = 10;
export const MAX_FAILURES_PER_IP = 10;
export const MAX_FAILURES_GLOBAL = 100;

const memory = new Map<string, number[]>();

function memoryFailures(key: string): number[] {
  const cutoff = Date.now() - WINDOW_MINUTES * 60_000;
  const list = (memory.get(key) ?? []).filter((t) => t > cutoff);
  memory.set(key, list);
  return list;
}

function blockedMessage(retryAt: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((retryAt - now) / 60_000));
  return `Demasiados intentos fallidos. Probá de nuevo en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
}

/**
 * Cuándo se libera un límite: cuando vence el error que hace que se alcance el máximo
 * (el (cantidad - máximo + 1)-ésimo más viejo de la ventana).
 */
async function retryAt(q: Queryable, where: string, params: unknown[], count: number, max: number): Promise<number> {
  const [row] = await q.query<{ at: string }>(
    `select attempted_at as at from login_attempts
      where success = false and attempted_at > now() - interval '${WINDOW_MINUTES} minutes' and ${where}
      order by attempted_at asc offset ${Math.max(count - max, 0)} limit 1`,
    params,
  );
  return (row ? new Date(row.at).getTime() : Date.now()) + WINDOW_MINUTES * 60_000;
}

/** Devuelve un mensaje si hay que bloquear el intento por exceso de errores recientes. */
export async function checkLoginAllowed(ip: string, deviceId: string | null = null, q?: Queryable): Promise<string | null> {
  try {
    const db = q ?? (await getDb());
    if (deviceId) {
      const [row] = await db.query<{ n: number }>(
        `select count(*)::int as n from login_attempts
          where success = false and device = $1 and attempted_at > now() - interval '${WINDOW_MINUTES} minutes'`,
        [deviceId],
      );
      if (row.n >= MAX_FAILURES_PER_DEVICE) return blockedMessage(await retryAt(db, "device = $1", [deviceId], row.n, MAX_FAILURES_PER_DEVICE));
      return null;
    }
    const [row] = await db.query<{ ip_failures: number; global_failures: number }>(
      `select count(*) filter (where ip = $1)::int as ip_failures, count(*)::int as global_failures
         from login_attempts
        where success = false and device is null and attempted_at > now() - interval '${WINDOW_MINUTES} minutes'`,
      [ip],
    );
    if (row.ip_failures >= MAX_FAILURES_PER_IP) {
      return blockedMessage(await retryAt(db, "device is null and ip = $1", [ip], row.ip_failures, MAX_FAILURES_PER_IP));
    }
    if (row.global_failures >= MAX_FAILURES_GLOBAL) {
      return blockedMessage(await retryAt(db, "device is null", [], row.global_failures, MAX_FAILURES_GLOBAL));
    }
    return null;
  } catch {
    // Sin base disponible se usa un límite en memoria del proceso.
    const list = memoryFailures(deviceId ? `d:${deviceId}` : `ip:${ip}`);
    const max = deviceId ? MAX_FAILURES_PER_DEVICE : MAX_FAILURES_PER_IP;
    return list.length >= max ? blockedMessage(list[list.length - max] + WINDOW_MINUTES * 60_000) : null;
  }
}

export async function recordLoginAttempt(ip: string, success: boolean, deviceId: string | null = null, q?: Queryable): Promise<void> {
  if (!success) {
    const key = deviceId ? `d:${deviceId}` : `ip:${ip}`;
    memory.set(key, [...memoryFailures(key), Date.now()]);
  }
  try {
    const db = q ?? (await getDb());
    await db.query("insert into login_attempts (ip, success, device) values ($1, $2, $3)", [ip, success, deviceId]);
    await db.query("delete from login_attempts where attempted_at < now() - interval '2 days'");
  } catch {
    // El registro de intentos no debe impedir el ingreso si la base no responde.
  }
}
