import path from "node:path";

/**
 * Lectura centralizada de la configuración del entorno.
 * Ninguna función de este archivo lanza errores: devuelve el estado para que la UI
 * pueda mostrar mensajes comprensibles en la sección afectada sin bloquear todo.
 */

export type DbConfig =
  | { kind: "postgres"; url: string; source: string }
  | { kind: "pglite"; dataDir: string | null }
  | { kind: "missing" };

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export function getDbConfig(): DbConfig {
  const candidates = ["DATABASE_URL", "POSTGRES_URL"] as const;
  for (const key of candidates) {
    const value = process.env[key]?.trim();
    if (value) return { kind: "postgres", url: value, source: key };
  }
  const pgliteDir = process.env.PGLITE_DIR?.trim();
  if (pgliteDir) {
    return { kind: "pglite", dataDir: pgliteDir === ":memory:" ? null : path.resolve(pgliteDir) };
  }
  // En Vercel o con `next start` no se usa una base local: el disco no es persistente.
  if (isProductionRuntime()) return { kind: "missing" };
  return { kind: "pglite", dataDir: path.join(process.cwd(), ".data", "pglite") };
}

export type AiConfig =
  | { enabled: true; assistantModel: string; invoiceModel: string }
  | { enabled: false; reason: string };

/**
 * Modelos aprobados en la propuesta: uno rápido y económico para instrucciones cortas
 * y uno más potente para leer facturas. Se pueden cambiar por variables de entorno.
 */
export const DEFAULT_ASSISTANT_MODEL = "claude-haiku-5-5";
export const DEFAULT_INVOICE_MODEL = "claude-opus-5-5";

export function getAiConfig(): AiConfig {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return {
      enabled: false,
      reason:
        "Falta la clave de IA (ANTHROPIC_API_KEY). El inventario funciona igual; el asistente usa el modo básico sin IA y la lectura de facturas no está disponible.",
    };
  }
  return {
    enabled: true,
    assistantModel: process.env.IA_MODELO_ASISTENTE?.trim() || DEFAULT_ASSISTANT_MODEL,
    invoiceModel: process.env.IA_MODELO_FACTURAS?.trim() || DEFAULT_INVOICE_MODEL,
  };
}

export type StorageConfig =
  | { kind: "blob"; token: string }
  | { kind: "local"; dir: string }
  | { kind: "none"; reason: string };

export function getStorageConfig(): StorageConfig {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return { kind: "blob", token };
  const localDir = process.env.ARCHIVOS_DIR?.trim();
  if (localDir) return { kind: "local", dir: path.resolve(localDir) };
  if (isProductionRuntime()) {
    return {
      kind: "none",
      reason:
        "No hay almacenamiento de archivos configurado (BLOB_READ_WRITE_TOKEN): las facturas se pueden analizar, pero no se guarda una copia del archivo.",
    };
  }
  return { kind: "local", dir: path.join(process.cwd(), ".data", "archivos") };
}

export type AuthConfig =
  | { mode: "clave"; clave: string; sessionSecret: string | null }
  | { mode: "abierto-local" }
  | { mode: "sin-configurar" };

export function getAuthConfig(): AuthConfig {
  const clave = process.env.CLAVE_CONSULTORIO?.trim();
  if (clave) return { mode: "clave", clave, sessionSecret: process.env.SESSION_SECRET?.trim() || null };
  // Sin clave solo se permite el acceso abierto en desarrollo local (next dev).
  if (!isProductionRuntime()) return { mode: "abierto-local" };
  return { mode: "sin-configurar" };
}

export { APP_CURRENCY, APP_LOCALE, APP_TIME_ZONE } from "./constants";
