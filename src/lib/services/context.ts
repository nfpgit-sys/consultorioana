import { randomUUID } from "node:crypto";
import type { Queryable } from "@/lib/db/types";

/** Origen de una operación, tal como queda registrado en el historial. */
export const SOURCES = ["manual", "texto", "voz", "factura"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source | "sistema", string> = {
  manual: "Manual",
  texto: "Asistente (texto)",
  voz: "Asistente (voz)",
  factura: "Factura",
  sistema: "Sistema",
};

export interface ActionContext {
  source: Source;
  /** Nombre que la persona indicó en su dispositivo (opcional, no verificado). */
  actor?: string | null;
  /** Clave única de la acción para evitar duplicados por doble clic o reintentos. */
  idempotencyKey?: string | null;
}

export async function audit(
  tx: Queryable,
  ctx: ActionContext,
  entry: { entityType: string; entityId?: string | null; action: string; details?: unknown; operationId?: string | null },
) {
  await tx.query(
    `insert into audit_log (entity_type, entity_id, action, details, source, actor, operation_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.entityType,
      entry.entityId ?? null,
      entry.action,
      entry.details === undefined ? null : JSON.stringify(entry.details),
      ctx.source,
      ctx.actor ?? null,
      entry.operationId ?? null,
    ],
  );
}

export interface OperationOutcome<T> {
  operationId: string;
  result: T;
  /** true si la misma clave de idempotencia ya se había ejecutado: no se repitió nada. */
  duplicate: boolean;
}

/**
 * Registra una operación con su clave de idempotencia dentro de la transacción `tx`.
 * Si la clave ya existe, devuelve el resultado guardado y no ejecuta `fn`.
 */
export async function withOperation<T>(
  tx: Queryable,
  ctx: ActionContext,
  meta: { kind: string; summary?: string },
  fn: (operationId: string) => Promise<T>,
): Promise<OperationOutcome<T>> {
  const id = randomUUID();
  const key = ctx.idempotencyKey?.trim() || null;
  const inserted = await tx.query<{ id: string }>(
    `insert into operations (id, idempotency_key, kind, source, actor, summary)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (idempotency_key) do nothing
     returning id`,
    [id, key, meta.kind, ctx.source, ctx.actor ?? null, meta.summary ?? null],
  );
  if (inserted.length === 0) {
    const [existing] = await tx.query<{ id: string; result: T }>(
      "select id, result from operations where idempotency_key = $1",
      [key],
    );
    return { operationId: existing.id, result: existing.result, duplicate: true };
  }
  const result = await fn(id);
  await tx.query("update operations set result = $2 where id = $1", [id, JSON.stringify(result ?? null)]);
  return { operationId: id, result, duplicate: false };
}
