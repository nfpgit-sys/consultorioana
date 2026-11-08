import type { Queryable } from "@/lib/db/types";
import { formatQuantity } from "@/lib/domain/format";
import { toDecimalString, toNumber } from "@/lib/domain/numbers";
import { round3 } from "@/lib/domain/units";
import type { ActionContext } from "./context";
import { DomainError } from "./errors";
import type { LockedProduct } from "./products";
import type { MovementKind } from "./types";

/**
 * Motor de stock: única función que modifica existencias.
 * - Registra un movimiento inmutable por cada cambio (o por lote afectado).
 * - Mantiene products.current_stock = suma de lotes cuando el producto controla vencimientos.
 * - Nunca deja stock ni lotes en negativo.
 * Debe llamarse dentro de una transacción con el producto bloqueado (FOR UPDATE).
 */
export interface StockChange {
  product: LockedProduct;
  /** Variación con signo en la unidad base (+ suma, − resta). */
  delta: number;
  kind: MovementKind;
  inputQuantity?: number | null;
  inputUnit?: string | null;
  unitCost?: number | null;
  reason?: string | null;
  purchaseId?: string | null;
  purchaseItemId?: string | null;
  reversesMovementId?: string | null;
  /** Lote: id existente, o código/vencimiento para ubicar o crear uno. */
  lot?: { lotId?: string | null; lotCode?: string | null; expiresOn?: string | null } | null;
  effectiveDate?: string | null;
}

export interface AppliedMovement {
  id: string;
  number: number;
  productId: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  lotId: string | null;
}

interface LotRow {
  id: string;
  quantity: string;
  lot_code: string | null;
  expires_on: string | null;
}

async function insertMovement(
  tx: Queryable,
  ctx: ActionContext,
  operationId: string,
  change: StockChange,
  quantity: number,
  stockBefore: number,
  stockAfter: number,
  lotId: string | null,
): Promise<AppliedMovement> {
  const [row] = await tx.query<{ id: string; number: number }>(
    `insert into stock_movements (product_id, lot_id, kind, quantity, stock_before, stock_after, input_quantity, input_unit,
       unit_cost, reason, source, purchase_id, purchase_item_id, reverses_movement_id, operation_id, actor, effective_date)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
       coalesce($17::date, (now() at time zone 'America/Argentina/Buenos_Aires')::date))
     returning id, number`,
    [
      change.product.id,
      lotId,
      change.kind,
      toDecimalString(quantity),
      toDecimalString(stockBefore),
      toDecimalString(stockAfter),
      change.inputQuantity === null || change.inputQuantity === undefined ? null : toDecimalString(change.inputQuantity),
      change.inputUnit ?? null,
      change.unitCost === null || change.unitCost === undefined ? null : toDecimalString(change.unitCost, 4),
      change.reason ?? null,
      ctx.source,
      change.purchaseId ?? null,
      change.purchaseItemId ?? null,
      change.reversesMovementId ?? null,
      operationId,
      ctx.actor ?? null,
      change.effectiveDate ?? null,
    ],
  );
  return { id: row.id, number: row.number, productId: change.product.id, quantity, stockBefore, stockAfter, lotId };
}

async function findOrCreateLot(tx: Queryable, productId: string, lotCode: string | null, expiresOn: string | null): Promise<LotRow> {
  const [row] = await tx.query<LotRow>(
    `insert into lots (product_id, lot_code, expires_on, quantity) values ($1, $2, $3, 0)
     on conflict (product_id, (coalesce(lot_code, '')), (coalesce(expires_on, 'infinity'::date)))
     do update set updated_at = now()
     returning id, quantity, lot_code, expires_on`,
    [productId, lotCode, expiresOn],
  );
  const [locked] = await tx.query<LotRow>("select id, quantity, lot_code, expires_on from lots where id = $1 for update", [row.id]);
  return locked;
}

export async function applyStockChange(
  tx: Queryable,
  ctx: ActionContext,
  operationId: string,
  change: StockChange,
): Promise<AppliedMovement[]> {
  const product = change.product;
  const delta = round3(change.delta);
  if (delta === 0) throw new DomainError("cantidad_invalida", "La cantidad del movimiento no puede ser cero.");
  const before = product.current_stock;
  const after = round3(before + delta);
  if (after < 0) {
    throw new DomainError(
      "stock_insuficiente",
      `No hay stock suficiente de "${product.name}": hay ${formatQuantity(before, product.base_unit)} y se quieren descontar ${formatQuantity(-delta, product.base_unit)}.`,
      { details: { productId: product.id, stock: before, requested: -delta } },
    );
  }

  const applied: AppliedMovement[] = [];

  if (!product.tracks_expiry) {
    applied.push(await insertMovement(tx, ctx, operationId, change, delta, before, after, null));
  } else if (delta > 0) {
    const lot = change.lot?.lotId
      ? await lockLot(tx, product.id, change.lot.lotId)
      : await findOrCreateLot(tx, product.id, change.lot?.lotCode?.trim() || null, change.lot?.expiresOn || null);
    await tx.query("update lots set quantity = quantity + $2, updated_at = now() where id = $1", [lot.id, toDecimalString(delta)]);
    applied.push(await insertMovement(tx, ctx, operationId, change, delta, before, after, lot.id));
  } else {
    // Descuento: del lote indicado o, si no se indica, primero el que vence antes (FEFO).
    let remaining = -delta;
    const lots = change.lot?.lotId
      ? [await lockLot(tx, product.id, change.lot.lotId)]
      : await tx.query<LotRow>(
          `select id, quantity, lot_code, expires_on from lots
           where product_id = $1 and quantity > 0
           order by expires_on asc nulls last, created_at asc
           for update`,
          [product.id],
        );
    let running = before;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const available = toNumber(lot.quantity);
      const take = round3(Math.min(available, remaining));
      if (take <= 0) continue;
      await tx.query("update lots set quantity = quantity - $2, updated_at = now() where id = $1", [lot.id, toDecimalString(take)]);
      const next = round3(running - take);
      applied.push(await insertMovement(tx, ctx, operationId, change, -take, running, next, lot.id));
      running = next;
      remaining = round3(remaining - take);
    }
    if (remaining > 0) {
      const lotLabel = change.lot?.lotId ? "el lote elegido" : "los lotes registrados";
      throw new DomainError(
        "stock_insuficiente",
        `No hay suficiente cantidad en ${lotLabel} de "${product.name}" para descontar ${formatQuantity(-delta, product.base_unit)}.`,
      );
    }
  }

  await tx.query("update products set current_stock = $2, updated_at = now() where id = $1", [product.id, toDecimalString(after)]);
  product.current_stock = after;
  return applied;
}

async function lockLot(tx: Queryable, productId: string, lotId: string): Promise<LotRow> {
  const [lot] = await tx.query<LotRow>(
    "select id, quantity, lot_code, expires_on from lots where id = $1 and product_id = $2 for update",
    [lotId, productId],
  );
  if (!lot) throw new DomainError("lote_invalido", "El lote indicado no pertenece a este producto.");
  return lot;
}
