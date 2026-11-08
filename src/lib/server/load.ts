import "server-only";
import { DatabaseNotConfiguredError, getDb } from "@/lib/db";
import type { Database } from "@/lib/db/types";

export interface SystemError {
  kind: "sin_base" | "base_inaccesible" | "inesperado";
  title: string;
  message: string;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: SystemError };

/**
 * Ejecuta una carga de datos para una página y convierte los errores de infraestructura
 * en un mensaje claro para mostrar en esa sección (sin tumbar el resto de la interfaz).
 */
export async function loadData<T>(fn: (db: Database) => Promise<T>): Promise<Loaded<T>> {
  try {
    const db = await getDb();
    return { ok: true, data: await fn(db) };
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return {
        ok: false,
        error: {
          kind: "sin_base",
          title: "Falta configurar la base de datos",
          message:
            "La aplicación está publicada pero no tiene una base de datos conectada (variable DATABASE_URL). Hasta configurarla no se pueden ver ni guardar datos.",
        },
      };
    }
    const code = (err as { code?: string })?.code;
    if (code && ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "28P01", "3D000", "57P01"].includes(code)) {
      console.error("[datos] base inaccesible:", err);
      return {
        ok: false,
        error: {
          kind: "base_inaccesible",
          title: "No se pudo conectar con la base de datos",
          message: "La base de datos no responde en este momento. Tus datos no se perdieron: probá recargar en unos segundos.",
        },
      };
    }
    console.error("[datos] error inesperado:", err);
    return {
      ok: false,
      error: {
        kind: "inesperado",
        title: "No se pudieron cargar los datos",
        message: "Ocurrió un error inesperado al leer la información. Probá recargar la página.",
      },
    };
  }
}
