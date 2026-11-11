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

export type AiProvider = "gemini" | "anthropic";

export type AiConfig =
  | {
      enabled: true;
      provider: AiProvider;
      providerName: string;
      /** Nombre de la variable de entorno que aporta la clave (nunca su valor). */
      keyVar: string;
      assistantModel: string;
      invoiceModel: string;
      /** Modelo alternativo para facturas si el principal está saturado, sin cupo o falla (null: sin respaldo). */
      invoiceFallbackModel: string | null;
      /** Aviso de privacidad para mostrar junto a los lugares donde se envían datos a la IA. */
      privacyNote: string | null;
    }
  | { enabled: false; reason: string };

/**
 * Modelos por defecto de cada proveedor: uno rápido y económico para las instrucciones
 * del asistente y uno más capaz para leer facturas (con un respaldo si ese está saturado).
 * Se cambian con IA_MODELO_ASISTENTE, IA_MODELO_FACTURAS e IA_MODELO_FACTURAS_RESPALDO. En Gemini se usan los alias "-latest", que Google actualiza solo
 * cuando retira un modelo (así la app no deja de funcionar por un cambio de versión).
 */
export const AI_DEFAULTS: Record<AiProvider, { name: string; assistantModel: string; invoiceModel: string; invoiceFallbackModel: string | null }> = {
  gemini: { name: "Gemini (Google)", assistantModel: "gemini-flash-lite-latest", invoiceModel: "gemini-flash-latest", invoiceFallbackModel: "gemini-flash-lite-latest" },
  // Claude ya tiene respaldo del lado del servidor (server-side fallback).
  anthropic: { name: "Claude (Anthropic)", assistantModel: "claude-haiku-5-5", invoiceModel: "claude-opus-5-5", invoiceFallbackModel: null },
};

export const GEMINI_PRIVACY_NOTE =
  "Lo que se envía a la IA lo procesa Google (Gemini). En el plan gratuito, Google puede usar y revisar esos datos para mejorar sus productos: no incluyas datos de pacientes.";

/** Variable que aporta la clave de Gemini (la primera definida), o null. */
export function geminiKeyVar(): "GEMINI_API_KEY" | "GOOGLE_API_KEY" | null {
  if (process.env.GEMINI_API_KEY?.trim()) return "GEMINI_API_KEY";
  if (process.env.GOOGLE_API_KEY?.trim()) return "GOOGLE_API_KEY";
  return null;
}

/** IA_MODELO_FACTURAS_RESPALDO: otro modelo, o «ninguno» para no usar respaldo. */
function fallbackModel(raw: string | undefined, def: string | null): string | null {
  const v = raw?.trim();
  if (!v) return def;
  return /^(ninguno|no|none|off)$/i.test(v) ? null : v;
}

export function getAiConfig(): AiConfig {
  const gemini = geminiKeyVar();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim() ? "ANTHROPIC_API_KEY" : null;
  const requested = process.env.IA_PROVEEDOR?.trim().toLowerCase() || null;

  let provider: AiProvider | null;
  if (requested) {
    if (requested === "gemini" || requested === "google") provider = "gemini";
    else if (requested === "claude" || requested === "anthropic") provider = "anthropic";
    else return { enabled: false, reason: `IA_PROVEEDOR tiene un valor no válido («${requested}»): usá «gemini» o «claude».` };
    if (provider === "gemini" && !gemini) {
      return { enabled: false, reason: "IA_PROVEEDOR indica Gemini, pero falta la clave GEMINI_API_KEY. El asistente usa el modo básico sin IA." };
    }
    if (provider === "anthropic" && !anthropic) {
      return { enabled: false, reason: "IA_PROVEEDOR indica Claude, pero falta la clave ANTHROPIC_API_KEY. El asistente usa el modo básico sin IA." };
    }
  } else {
    // Sin preferencia explícita: Gemini si hay clave de Google; si no, Claude.
    provider = gemini ? "gemini" : anthropic ? "anthropic" : null;
  }

  if (!provider) {
    return {
      enabled: false,
      reason:
        "Falta la clave de IA (GEMINI_API_KEY). El inventario funciona igual; el asistente usa el modo básico sin IA y la lectura de facturas no está disponible.",
    };
  }
  const defaults = AI_DEFAULTS[provider];
  return {
    enabled: true,
    provider,
    providerName: defaults.name,
    keyVar: provider === "gemini" ? (gemini as string) : "ANTHROPIC_API_KEY",
    assistantModel: process.env.IA_MODELO_ASISTENTE?.trim() || defaults.assistantModel,
    invoiceModel: process.env.IA_MODELO_FACTURAS?.trim() || defaults.invoiceModel,
    invoiceFallbackModel: fallbackModel(process.env.IA_MODELO_FACTURAS_RESPALDO, defaults.invoiceFallbackModel),
    privacyNote: provider === "gemini" ? GEMINI_PRIVACY_NOTE : null,
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
