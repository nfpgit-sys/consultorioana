import "server-only";
import { getDb } from "@/lib/db";

const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_IP = 10;
const MAX_FAILURES_GLOBAL = 100;

const memory = new Map<string, number[]>();

function memoryFailures(ip: string): number {
  const cutoff = Date.now() - WINDOW_MINUTES * 60_000;
  const list = (memory.get(ip) ?? []).filter((t) => t > cutoff);
  memory.set(ip, list);
  return list.length;
}

/** Devuelve un mensaje si hay que bloquear el intento por exceso de errores recientes. */
export async function checkLoginAllowed(ip: string): Promise<string | null> {
  try {
    const db = await getDb();
    const [row] = await db.query<{ ip_failures: number; global_failures: number }>(
      `select
         count(*) filter (where ip = $1)::int as ip_failures,
         count(*)::int as global_failures
       from login_attempts
       where success = false and attempted_at > now() - ($2::int * interval '1 minute')`,
      [ip, WINDOW_MINUTES],
    );
    if (row.ip_failures >= MAX_FAILURES_PER_IP || row.global_failures >= MAX_FAILURES_GLOBAL) {
      return `Demasiados intentos fallidos. Esperá ${WINDOW_MINUTES} minutos y volvé a probar.`;
    }
    return null;
  } catch {
    // Sin base disponible se usa un límite en memoria del proceso.
    return memoryFailures(ip) >= MAX_FAILURES_PER_IP
      ? `Demasiados intentos fallidos. Esperá ${WINDOW_MINUTES} minutos y volvé a probar.`
      : null;
  }
}

export async function recordLoginAttempt(ip: string, success: boolean): Promise<void> {
  if (!success) {
    const list = memory.get(ip) ?? [];
    list.push(Date.now());
    memory.set(ip, list);
  }
  try {
    const db = await getDb();
    await db.query("insert into login_attempts (ip, success) values ($1, $2)", [ip, success]);
    await db.query("delete from login_attempts where attempted_at < now() - interval '2 days'");
  } catch {
    // El registro de intentos no debe impedir el ingreso si la base no responde.
  }
}
