import { z } from "zod";
import type { Database, Queryable } from "@/lib/db/types";
import { formatQuantity, todayAR } from "@/lib/domain/format";
import { toNumber, toNumberOrNull } from "@/lib/domain/numbers";
import { type BaseUnit, round3, toBaseQuantity } from "@/lib/domain/units";
import { type ActionContext, audit, withOperation } from "./context";
import { DomainError, NotFoundError, translateDbError } from "./errors";
import { type LockedProduct, lockProductForStock, lockProductsForStock, stockStatus } from "./products";
import { applyStockChange, type AppliedMovement } from "./stock";
import type { Movement, MovementKind, StockStatus, Warning } from "./types";
import { isoDate, optionalText, pastOrTodayDate, quantity, uuid } from "./validation";

export const DUPLICATE_WINDOW_MINUTES = 10;

const movementItemSchema = z.object({
  productId: uuid,
  quantity,
  unit: optionalText(40),
  kind: z.enum(["consumo", "ingreso"]),
  reason: optionalText(300),
  lotId: uuid.nullable().optional(),
  lotCode: optionalText(60),
  expiresOn: isoDate.nullable().optional(),
});

export const registerMovementsSchema = z.object({
  items: z.array(movementItemSchema).min(1, "Agregá al menos un producto.").max(30),
  effectiveDate: pastOrTodayDate.nullable().optional(),
  acknowledgeWarnings: z.boolean().default(false),
});
export type RegisterMovementsInput = z.input<typeof registerMovementsSchema>;

export interface MovementPlanLine {
  productId: string;
  productName: string;
  baseUnit: BaseUnit;
  kind: "consumo" | "ingreso";
  inputQuantity: number;
  inputUnit: string;
  baseQuantity: number;
  stockBefore: number;
  stockAfter: number;
  statusAfter: StockStatus;
  minStock: number;
}

export interface Plan<L> {
  ok: boolean;
  errors: string[];
  warnings: Warning[];
  lines: L[];
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/** Movimientos idénticos recientes (mismo producto, tipo y cantidad), no revertidos. */
export async function findRecentDuplicates(
  q: Queryable,
  productId: string,
  kind: MovementKind,
  signedQuantity: number,
  minutes = DUPLICATE_WINDOW_MINUTES,
) {
  return q.query<{ number: number; created_at: string; quantity: string }>(
    `select m.number, m.created_at, m.quantity from stock_movements m
     where m.product_id = $1 and m.kind = $2 and m.quantity = $3::numeric
       and m.created_at > now() - ($4::int * interval '1 minute')
       and not exists (select 1 from stock_movements r where r.reverses_movement_id = m.id)
     order by m.number desc limit 3`,
    [productId, kind, signedQuantity.toFixed(3), minutes],
  );
}

async function averageConsumption(q: Queryable, productId: string): Promise<{ avg: number; count: number }> {
  const [row] = await q.query<{ avg: string | null; count: number }>(
    `select avg(-quantity) as avg, count(*)::int as count from (
       select quantity from stock_movements where product_id = $1 and kind = 'consumo'
       order by number desc limit 20) t`,
    [productId],
  );
  return { avg: toNumber(row?.avg ?? 0) || 0, count: row?.count ?? 0 };
}

/**
 * Calcula el resultado de una carga de consumos/ingresos sin escribir nada:
 * conversiones, stock antes/después, errores y advertencias.
 * Se usa para la vista previa del asistente y se vuelve a ejecutar al confirmar.
 */
export async function planMovements(
  q: Queryable,
  input: z.output<typeof registerMovementsSchema>,
  lockedProducts?: Map<string, LockedProduct>,
): Promise<Plan<MovementPlanLine>> {
  const errors: string[] = [];
  const warnings: Warning[] = [];
  const lines: MovementPlanLine[] = [];
  const products = lockedProducts ?? (await loadProductsSnapshot(q, input.items.map((i) => i.productId)));
  const running = new Map<string, number>();

  for (const item of input.items) {
    const product = products.get(item.productId);
    if (!product || product.archived_at) {
      errors.push("Uno de los productos no existe o está archivado.");
      continue;
    }
    const conversion = toBaseQuantity(
      { name: product.name, baseUnit: product.base_unit, presentations: product.presentations },
      item.quantity,
      item.unit,
    );
    if (!conversion.ok) {
      errors.push(conversion.error);
      continue;
    }
    const before = running.get(product.id) ?? product.current_stock;
    const signed = item.kind === "consumo" ? -conversion.baseQuantity : conversion.baseQuantity;
    const after = round3(before + signed);
    if (after < 0) {
      errors.push(
        `No hay stock suficiente de "${product.name}": hay ${formatQuantity(before, product.base_unit)} y se quieren descontar ${formatQuantity(conversion.baseQuantity, product.base_unit)}. Si el stock real es distinto, registrá un ajuste.`,
      );
      continue;
    }
    running.set(product.id, after);
    lines.push({
      productId: product.id,
      productName: product.name,
      baseUnit: product.base_unit,
      kind: item.kind,
      inputQuantity: item.quantity,
      inputUnit: conversion.unitLabel,
      baseQuantity: conversion.baseQuantity,
      stockBefore: before,
      stockAfter: after,
      statusAfter: stockStatus(after, product.min_stock),
      minStock: product.min_stock,
    });

    const dupes = await findRecentDuplicates(q, product.id, item.kind, signed);
    if (dupes.length > 0) {
      const d = dupes[0];
      warnings.push({
        code: "posible_duplicado",
        requiresAck: true,
        message: `Ya se registró ${item.kind === "consumo" ? "un consumo" : "un ingreso"} de ${formatQuantity(conversion.baseQuantity, product.base_unit)} de "${product.name}" hace ${minutesAgo(d.created_at)} min (movimiento #${d.number}). ¿Es otro distinto?`,
      });
    }
    if (item.kind === "consumo") {
      if (after === 0) {
        warnings.push({ code: "stock_cero", requiresAck: true, message: `El stock de "${product.name}" quedará en 0.` });
      } else if (product.min_stock > 0 && after <= product.min_stock) {
        warnings.push({
          code: "stock_bajo",
          requiresAck: false,
          message: `"${product.name}" quedará en stock bajo (${formatQuantity(after, product.base_unit)}; mínimo ${formatQuantity(product.min_stock, product.base_unit)}).`,
        });
      }
      const { avg, count } = await averageConsumption(q, product.id);
      if (count >= 3 && avg > 0 && conversion.baseQuantity >= avg * 10) {
        warnings.push({
          code: "cantidad_inusual",
          requiresAck: true,
          message: `La cantidad es inusual: el consumo habitual de "${product.name}" es de ${formatQuantity(round3(avg), product.base_unit)} por registro.`,
        });
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, lines };
}

async function loadProductsSnapshot(q: Queryable, ids: string[]): Promise<Map<string, LockedProduct>> {
  // Misma forma que el bloqueo pero sin FOR UPDATE (vista previa).
  const valid = [...new Set(ids)].filter((id) => uuid.safeParse(id).success);
  const map = new Map<string, LockedProduct>();
  if (!valid.length) return map;
  const rows = await q.query<{
    id: string;
    name: string;
    base_unit: BaseUnit;
    current_stock: string;
    min_stock: string;
    unit_cost: string | null;
    tracks_expiry: boolean;
    archived_at: string | null;
    category: string | null;
    description: string | null;
    barcode: string | null;
  }>(
    `select id, name, base_unit, current_stock, min_stock, unit_cost, tracks_expiry, archived_at, category, description, barcode
     from products where id = any($1::uuid[])`,
    [valid],
  );
  const pres = await q.query<{ product_id: string; id: string; name: string; factor: string }>(
    "select product_id, id, name, factor from product_presentations where product_id = any($1::uuid[]) and archived_at is null",
    [valid],
  );
  for (const r of rows) {
    map.set(r.id, {
      ...r,
      current_stock: toNumber(r.current_stock),
      min_stock: toNumber(r.min_stock),
      unit_cost: toNumberOrNull(r.unit_cost),
      presentations: pres.filter((p) => p.product_id === r.id).map((p) => ({ id: p.id, name: p.name, factor: toNumber(p.factor) })),
    });
  }
  return map;
}

export class ConfirmationRequiredError extends DomainError {
  constructor(warnings: Warning[]) {
    super("requiere_confirmacion", "La operación necesita una confirmación adicional.", {
      status: 409,
      details: { warnings },
    });
  }
}

function assertPlan<L>(plan: Plan<L>, acknowledge: boolean) {
  if (!plan.ok) throw new DomainError("operacion_invalida", plan.errors.join(" "), { details: { errors: plan.errors } });
  if (!acknowledge && plan.warnings.some((w) => w.requiresAck)) throw new ConfirmationRequiredError(plan.warnings);
}

export async function previewMovements(db: Database, raw: RegisterMovementsInput) {
  const input = registerMovementsSchema.parse(raw);
  return planMovements(db, input);
}

/** Registra consumos e ingresos en una única operación atómica. */
export async function registerMovements(db: Database, raw: RegisterMovementsInput, ctx: ActionContext) {
  const input = registerMovementsSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const products = await lockProductsForStock(tx, input.items.map((i) => i.productId));
      const plan = await planMovements(tx, input, products);
      // Si la clave de idempotencia ya existe, se devuelve el resultado anterior sin validar de nuevo.
      const summary = plan.lines
        .map((l) => `${l.kind === "consumo" ? "−" : "+"}${formatQuantity(l.baseQuantity, l.baseUnit)} ${l.productName}`)
        .join(", ");
      return withOperation(tx, ctx, { kind: "movimientos", summary }, async (operationId) => {
        assertPlan(plan, input.acknowledgeWarnings);
        const applied: AppliedMovement[] = [];
        for (const item of input.items) {
          const product = products.get(item.productId)!;
          const conversion = toBaseQuantity(
            { name: product.name, baseUnit: product.base_unit, presentations: product.presentations },
            item.quantity,
            item.unit,
          );
          if (!conversion.ok) throw new DomainError("conversion", conversion.error);
          const result = await applyStockChange(tx, ctx, operationId, {
            product,
            delta: item.kind === "consumo" ? -conversion.baseQuantity : conversion.baseQuantity,
            kind: item.kind,
            inputQuantity: item.quantity,
            inputUnit: conversion.unitLabel,
            reason: item.reason ?? null,
            unitCost: product.unit_cost,
            lot: { lotId: item.lotId ?? null, lotCode: item.lotCode ?? null, expiresOn: item.expiresOn ?? null },
            effectiveDate: input.effectiveDate ?? null,
          });
          applied.push(...result);
        }
        await audit(tx, ctx, {
          entityType: "movimientos",
          action: "registrar",
          details: { items: input.items, fecha: input.effectiveDate ?? todayAR() },
          operationId,
        });
        return {
          movements: applied.map((m) => ({ id: m.id, number: m.number, productId: m.productId, quantity: m.quantity, stockAfter: m.stockAfter })),
          summary,
        };
      });
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export const adjustStockSchema = z.object({
  productId: uuid,
  newStock: z.number().finite().min(0, "El stock no puede ser negativo.").max(1_000_000_000),
  reason: z.string().trim().min(3, "Indicá el motivo del ajuste.").max(300),
  lotId: uuid.nullable().optional(),
  acknowledgeWarnings: z.boolean().default(false),
});
export type AdjustStockInput = z.input<typeof adjustStockSchema>;

export async function planAdjustment(q: Queryable, input: z.output<typeof adjustStockSchema>, locked?: LockedProduct | null) {
  const product = locked ?? (await loadProductsSnapshot(q, [input.productId])).get(input.productId);
  if (!product || product.archived_at) throw new NotFoundError("El producto");
  const errors: string[] = [];
  const warnings: Warning[] = [];
  let before = product.current_stock;
  if (product.tracks_expiry && input.lotId) {
    const [lot] = await q.query<{ quantity: string }>("select quantity from lots where id = $1 and product_id = $2", [input.lotId, product.id]);
    if (!lot) errors.push("El lote indicado no pertenece a este producto.");
    else before = toNumber(lot.quantity);
  }
  const target = round3(input.newStock);
  const delta = round3(target - before);
  if (delta === 0) errors.push(`El stock ya es ${formatQuantity(target, product.base_unit)}: no hay nada que ajustar.`);
  if (product.tracks_expiry && !input.lotId && delta !== 0) {
    errors.push("Este producto controla lotes y vencimientos: elegí el lote que querés ajustar.");
  }
  const productAfter = round3(product.current_stock + delta);
  if (Math.abs(delta) >= Math.max(10, before * 0.5)) {
    warnings.push({
      code: "ajuste_grande",
      requiresAck: true,
      message: `Es un ajuste grande: el stock pasa de ${formatQuantity(before, product.base_unit)} a ${formatQuantity(target, product.base_unit)}.`,
    });
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    product,
    line: { productName: product.name, baseUnit: product.base_unit, stockBefore: product.current_stock, stockAfter: productAfter, delta },
  };
}

export async function adjustStock(db: Database, raw: AdjustStockInput, ctx: ActionContext) {
  const input = adjustStockSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const product = await lockProductForStock(tx, input.productId);
      const plan = await planAdjustment(tx, input, product);
      return withOperation(tx, ctx, { kind: "ajuste", summary: `Ajuste de ${plan.line.productName}` }, async (operationId) => {
        assertPlan({ ok: plan.ok, errors: plan.errors, warnings: plan.warnings, lines: [] }, input.acknowledgeWarnings);
        const applied = await applyStockChange(tx, ctx, operationId, {
          product: plan.product,
          delta: plan.line.delta,
          kind: "ajuste",
          reason: input.reason,
          unitCost: plan.product.unit_cost,
          lot: input.lotId ? { lotId: input.lotId } : null,
        });
        await audit(tx, ctx, {
          entityType: "producto",
          entityId: input.productId,
          action: "ajustar_stock",
          details: { motivo: input.reason, antes: plan.line.stockBefore, despues: plan.line.stockAfter },
          operationId,
        });
        return { movements: applied.map((m) => ({ id: m.id, number: m.number })), stockAfter: plan.line.stockAfter };
      });
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export const reverseMovementSchema = z.object({
  movementId: uuid,
  reason: z.string().trim().min(3, "Indicá el motivo de la reversión.").max(300),
});

interface MovementForReversal {
  id: string;
  number: number;
  product_id: string;
  lot_id: string | null;
  kind: MovementKind;
  quantity: string;
  purchase_id: string | null;
  purchase_number: number | null;
  reversed_by: number | null;
}

async function loadMovementForReversal(q: Queryable, movementId: string): Promise<MovementForReversal> {
  const [m] = await q.query<MovementForReversal>(
    `select m.id, m.number, m.product_id, m.lot_id, m.kind, m.quantity, m.purchase_id, p.number as purchase_number,
       (select r.number from stock_movements r where r.reverses_movement_id = m.id) as reversed_by
     from stock_movements m left join purchases p on p.id = m.purchase_id where m.id = $1`,
    [movementId],
  );
  if (!m) throw new NotFoundError("El movimiento");
  return m;
}

export async function planReversal(q: Queryable, movementId: string) {
  const m = await loadMovementForReversal(q, movementId);
  const errors: string[] = [];
  if (m.kind === "reversion") errors.push("No se puede revertir una reversión. Si hace falta, registrá un ajuste.");
  if (m.reversed_by) errors.push(`El movimiento #${m.number} ya fue revertido (movimiento #${m.reversed_by}).`);
  if (m.purchase_id) {
    errors.push(`El movimiento #${m.number} pertenece a la compra #${m.purchase_number}: para corregirlo, anulá la compra.`);
  }
  const product = (await loadProductsSnapshot(q, [m.product_id])).get(m.product_id)!;
  const delta = -toNumber(m.quantity);
  const after = round3(product.current_stock + delta);
  if (after < 0) {
    errors.push(
      `No se puede revertir: hoy hay ${formatQuantity(product.current_stock, product.base_unit)} de "${product.name}" y la reversión quitaría ${formatQuantity(-delta, product.base_unit)}.`,
    );
  }
  return {
    ok: errors.length === 0,
    errors,
    movement: m,
    line: { productName: product.name, baseUnit: product.base_unit, stockBefore: product.current_stock, stockAfter: after, delta },
  };
}

/** Corrige un movimiento con otro de signo contrario. El original queda en el historial. */
export async function reverseMovement(db: Database, raw: z.input<typeof reverseMovementSchema>, ctx: ActionContext) {
  const input = reverseMovementSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const m = await loadMovementForReversal(tx, input.movementId);
      const product = await lockProductForStock(tx, m.product_id);
      if (!product) throw new NotFoundError("El producto");
      const plan = await planReversal(tx, input.movementId);
      return withOperation(tx, ctx, { kind: "reversion", summary: `Reversión del movimiento #${m.number}` }, async (operationId) => {
        if (!plan.ok) throw new DomainError("reversion_invalida", plan.errors.join(" "));
        const applied = await applyStockChange(tx, ctx, operationId, {
          product,
          delta: plan.line.delta,
          kind: "reversion",
          reason: input.reason,
          reversesMovementId: m.id,
          unitCost: product.unit_cost,
          lot: m.lot_id ? { lotId: m.lot_id } : null,
        });
        await audit(tx, ctx, {
          entityType: "movimiento",
          entityId: m.id,
          action: "revertir",
          details: { numero: m.number, motivo: input.reason },
          operationId,
        });
        return { movements: applied.map((a) => ({ id: a.id, number: a.number })), reversedNumber: m.number };
      });
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

interface MovementRow {
  id: string;
  number: number;
  product_id: string;
  product_name: string;
  base_unit: BaseUnit;
  lot_id: string | null;
  lot_code: string | null;
  lot_expires_on: string | null;
  kind: MovementKind;
  quantity: string;
  stock_before: string;
  stock_after: string;
  input_quantity: string | null;
  input_unit: string | null;
  unit_cost: string | null;
  reason: string | null;
  source: string;
  purchase_id: string | null;
  purchase_number: number | null;
  reverses_movement_id: string | null;
  reverses_number: number | null;
  reversed_by_number: number | null;
  operation_id: string;
  actor: string | null;
  effective_date: string;
  created_at: string;
}

function mapMovement(r: MovementRow): Movement {
  return {
    id: r.id,
    number: r.number,
    productId: r.product_id,
    productName: r.product_name,
    baseUnit: r.base_unit,
    lotId: r.lot_id,
    lotCode: r.lot_code,
    lotExpiresOn: r.lot_expires_on,
    kind: r.kind,
    quantity: toNumber(r.quantity),
    stockBefore: toNumber(r.stock_before),
    stockAfter: toNumber(r.stock_after),
    inputQuantity: toNumberOrNull(r.input_quantity),
    inputUnit: r.input_unit,
    unitCost: toNumberOrNull(r.unit_cost),
    reason: r.reason,
    source: r.source,
    purchaseId: r.purchase_id,
    purchaseNumber: r.purchase_number,
    reversesMovementId: r.reverses_movement_id,
    reversesNumber: r.reverses_number,
    reversedByNumber: r.reversed_by_number,
    operationId: r.operation_id,
    actor: r.actor,
    effectiveDate: r.effective_date,
    createdAt: r.created_at,
  };
}

export interface MovementFilters {
  productId?: string | null;
  kind?: MovementKind | null;
  source?: string | null;
  from?: string | null;
  to?: string | null;
  category?: string | null;
  operationId?: string | null;
  purchaseId?: string | null;
  limit?: number;
  offset?: number;
}

export async function listMovements(q: Queryable, filters: MovementFilters = {}): Promise<{ movements: Movement[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.productId && uuid.safeParse(filters.productId).success) add("m.product_id = ?", filters.productId);
  if (filters.kind) add("m.kind = ?", filters.kind);
  if (filters.source) add("m.source = ?", filters.source);
  if (filters.from) add("m.effective_date >= ?::date", filters.from);
  if (filters.to) add("m.effective_date <= ?::date", filters.to);
  if (filters.category) add("p.category = ?", filters.category);
  if (filters.operationId && uuid.safeParse(filters.operationId).success) add("m.operation_id = ?", filters.operationId);
  if (filters.purchaseId && uuid.safeParse(filters.purchaseId).success) add("m.purchase_id = ?", filters.purchaseId);
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const rows = await q.query<MovementRow>(
    `select m.id, m.number, m.product_id, p.name as product_name, p.base_unit, m.lot_id, l.lot_code, l.expires_on as lot_expires_on,
       m.kind, m.quantity, m.stock_before, m.stock_after, m.input_quantity, m.input_unit, m.unit_cost, m.reason, m.source,
       m.purchase_id, pu.number as purchase_number, m.reverses_movement_id, o.number as reverses_number,
       (select r.number from stock_movements r where r.reverses_movement_id = m.id) as reversed_by_number,
       m.operation_id, m.actor, m.effective_date, m.created_at
     from stock_movements m
     join products p on p.id = m.product_id
     left join lots l on l.id = m.lot_id
     left join purchases pu on pu.id = m.purchase_id
     left join stock_movements o on o.id = m.reverses_movement_id
     ${whereSql}
     order by m.number desc
     limit ${limit} offset ${offset}`,
    params,
  );
  const [{ total }] = await q.query<{ total: number }>(
    `select count(*)::int as total from stock_movements m join products p on p.id = m.product_id ${whereSql}`,
    params,
  );
  return { movements: rows.map(mapMovement), total };
}

export async function getMovement(q: Queryable, id: string): Promise<Movement | null> {
  if (!uuid.safeParse(id).success) return null;
  const rows = await q.query<MovementRow>(
    `select m.id, m.number, m.product_id, p.name as product_name, p.base_unit, m.lot_id, l.lot_code, l.expires_on as lot_expires_on,
       m.kind, m.quantity, m.stock_before, m.stock_after, m.input_quantity, m.input_unit, m.unit_cost, m.reason, m.source,
       m.purchase_id, pu.number as purchase_number, m.reverses_movement_id, o.number as reverses_number,
       (select r.number from stock_movements r where r.reverses_movement_id = m.id) as reversed_by_number,
       m.operation_id, m.actor, m.effective_date, m.created_at
     from stock_movements m
     join products p on p.id = m.product_id
     left join lots l on l.id = m.lot_id
     left join purchases pu on pu.id = m.purchase_id
     left join stock_movements o on o.id = m.reverses_movement_id
     where m.id = $1`,
    [id],
  );
  return rows[0] ? mapMovement(rows[0]) : null;
}
