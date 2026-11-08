import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth/server";
import { DatabaseNotConfiguredError } from "@/lib/db";
import { DomainError } from "@/lib/services/errors";
import { firstZodMessage } from "@/lib/services/validation";
import type { Warning } from "@/lib/services/types";

export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | {
      ok: false;
      error: string;
      code?: string;
      warnings?: Warning[];
      details?: Record<string, unknown>;
    };

/** Convierte cualquier error en un mensaje comprensible; nunca expone detalles internos. */
export function toActionError(err: unknown): Extract<ActionResult, { ok: false }> {
  if (err instanceof DomainError) {
    const warnings = (err.details?.warnings as Warning[] | undefined) ?? undefined;
    return { ok: false, error: err.message, code: err.code, warnings, details: err.details };
  }
  if (err instanceof ZodError) return { ok: false, error: firstZodMessage(err), code: "validacion" };
  if (err instanceof UnauthorizedError) return { ok: false, error: err.message, code: "no_autorizado" };
  if (err instanceof DatabaseNotConfiguredError) {
    return { ok: false, error: "La base de datos no está configurada: no se pudo guardar el cambio.", code: "sin_base" };
  }
  console.error("[accion] error inesperado:", err);
  return {
    ok: false,
    error: "Ocurrió un error inesperado y no se guardó ningún cambio. Probá de nuevo en unos segundos.",
    code: "inesperado",
  };
}

export async function runAction<T>(fn: () => Promise<T>, opts: { message?: string; revalidate?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (opts.revalidate !== false) revalidatePath("/", "layout");
    return { ok: true, data, message: opts.message };
  } catch (err) {
    return toActionError(err);
  }
}
