/**
 * Errores de dominio con mensajes en español pensados para mostrarse tal cual al usuario.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, opts: { status?: number; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = opts.status ?? 422;
    this.details = opts.details;
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super("no_encontrado", `${what} no existe o fue archivado.`, { status: 404 });
  }
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  products_name_uq: "Ya existe un producto activo con ese nombre.",
  suppliers_name_uq: "Ya existe un proveedor con ese nombre.",
  suppliers_cuit_uq: "Ya existe un proveedor con ese CUIT.",
  product_presentations_uq: "Ese producto ya tiene una presentación con ese nombre.",
  purchases_doc_uq: "Ese comprobante ya está registrado para este proveedor.",
  expenses_doc_uq: "Ese comprobante ya está registrado como gasto para este proveedor.",
  stock_movements_reverses_uq: "Ese movimiento ya fue revertido.",
  products_current_stock_check: "La operación dejaría el stock en negativo.",
  stock_movements_stock_after_check: "La operación dejaría el stock en negativo.",
  lots_quantity_check: "La operación dejaría un lote con cantidad negativa.",
};

/** Traduce errores de PostgreSQL conocidos a errores de dominio comprensibles. */
export function translateDbError(err: unknown): unknown {
  if (err instanceof DomainError) return err;
  const e = err as PgErrorLike;
  if (!e || typeof e !== "object") return err;
  const constraint = e.constraint ?? /constraint "([^"]+)"/.exec(e.message ?? "")?.[1];
  if (constraint && CONSTRAINT_MESSAGES[constraint]) {
    return new DomainError("restriccion", CONSTRAINT_MESSAGES[constraint], { status: 409 });
  }
  if (e.code === "P0001" && e.message) return new DomainError("historial_inmutable", e.message, { status: 409 });
  return err;
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
