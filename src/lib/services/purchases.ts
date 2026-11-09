import { z } from "zod";
import type { Database, Queryable } from "@/lib/db/types";
import { formatARS, formatDate, formatQuantity } from "@/lib/domain/format";
import { normalizeName } from "@/lib/domain/normalize";
import { toDecimalString, toNumber, toNumberOrNull } from "@/lib/domain/numbers";
import { type BaseUnit, round2, round3, toBaseQuantity } from "@/lib/domain/units";
import { type ActionContext, audit, withOperation } from "./context";
import { DOC_TYPES, type DocType } from "./documents-types";
import { sameFileRegisteredWarning } from "./duplicate-files";
import { DomainError, NotFoundError, translateDbError } from "./errors";
import { ConfirmationRequiredError } from "./movements";
import { type LockedProduct, lockProductsForStock } from "./products";
import { applyStockChange } from "./stock";
import { findSupplierExact, normalizeCuit, resolveOrCreateSupplier } from "./suppliers";
import type { Warning } from "./types";
import { isoDate, money, optionalText, pastOrTodayDate, quantity, uuid } from "./validation";

const purchaseItemSchema = z.object({
  /** null = línea no inventariable (flete, servicio, etc.). */
  productId: uuid.nullable().optional(),
  description: optionalText(300),
  quantity,
  unit: optionalText(40),
  unitPrice: money.nullable().optional(),
  lineTotal: money.nullable().optional(),
  lotCode: optionalText(60),
  expiresOn: isoDate.nullable().optional(),
  /** Texto tal como figura en la factura, para aprender la asociación con el producto. */
  learnAlias: optionalText(300),
});

export const createPurchaseSchema = z.object({
  supplierId: uuid.nullable().optional(),
  supplierName: optionalText(200),
  supplierCuit: optionalText(20),
  purchaseDate: pastOrTodayDate,
  docType: z.enum(DOC_TYPES).nullable().optional(),
  docNumber: optionalText(40),
  items: z.array(purchaseItemSchema).min(1, "La compra necesita al menos una línea.").max(100),
  taxAmount: money.nullable().optional(),
  otherTaxes: money.nullable().optional(),
  total: money.nullable().optional(),
  notes: optionalText(1000),
  documentId: uuid.nullable().optional(),
  acknowledgeWarnings: z.boolean().default(false),
});
export type CreatePurchaseInput = z.input<typeof createPurchaseSchema>;
type PurchaseInput = z.output<typeof createPurchaseSchema>;

export interface PurchasePlanLine {
  index: number;
  productId: string | null;
  productName: string | null;
  description: string;
  quantity: number;
  unitLabel: string;
  baseQuantity: number | null;
  baseUnit: BaseUnit | null;
  lineTotal: number | null;
  /** Costo efectivo por unidad base (incluye impuestos prorrateados). */
  effectiveUnitCost: number | null;
  stockBefore: number | null;
  stockAfter: number | null;
}

export interface PurchasePlan {
  ok: boolean;
  errors: string[];
  warnings: Warning[];
  lines: PurchasePlanLine[];
  sumLines: number | null;
  total: number | null;
  status: "registrada" | "pendiente_precio";
  supplier: { id: string | null; name: string | null; isNew: boolean };
}

export function normalizeDocNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, "").toUpperCase();
  const m = /^(?:[ABCM]-?)?(\d{1,5})-(\d{1,8})$/.exec(cleaned);
  if (m) return `${m[1].padStart(5, "0")}-${m[2].padStart(8, "0")}`;
  return cleaned || null;
}

export async function planPurchase(q: Queryable, input: PurchaseInput, locked?: Map<string, LockedProduct>): Promise<PurchasePlan> {
  const errors: string[] = [];
  const warnings: Warning[] = [];
  const productIds = input.items.map((i) => i.productId).filter((id): id is string => Boolean(id));
  const products = locked ?? (await snapshotProducts(q, productIds));
  const running = new Map<string, number>();
  const lines: PurchasePlanLine[] = [];

  input.items.forEach((item, index) => {
    const n = index + 1;
    let lineTotal: number | null = null;
    if (item.lineTotal !== null && item.lineTotal !== undefined) {
      lineTotal = round2(item.lineTotal);
      if (item.unitPrice !== null && item.unitPrice !== undefined) {
        const expected = round2(item.unitPrice * item.quantity);
        if (Math.abs(expected - lineTotal) > Math.max(1, lineTotal * 0.01)) {
          warnings.push({
            code: "importe_linea",
            requiresAck: true,
            message: `Línea ${n}: ${item.quantity} × ${formatARS(item.unitPrice)} = ${formatARS(expected)}, pero el importe indicado es ${formatARS(lineTotal)}.`,
          });
        }
      }
    } else if (item.unitPrice !== null && item.unitPrice !== undefined) {
      lineTotal = round2(item.unitPrice * item.quantity);
    }

    if (!item.productId) {
      if (!item.description) errors.push(`Línea ${n}: indicá una descripción o elegí un producto del inventario.`);
      lines.push({
        index,
        productId: null,
        productName: null,
        description: item.description ?? "",
        quantity: item.quantity,
        unitLabel: item.unit ?? "",
        baseQuantity: null,
        baseUnit: null,
        lineTotal,
        effectiveUnitCost: null,
        stockBefore: null,
        stockAfter: null,
      });
      return;
    }
    const product = products.get(item.productId);
    if (!product || product.archived_at) {
      errors.push(`Línea ${n}: el producto no existe o está archivado.`);
      return;
    }
    const conversion = toBaseQuantity(
      { name: product.name, baseUnit: product.base_unit, presentations: product.presentations },
      item.quantity,
      item.unit,
    );
    if (!conversion.ok) {
      errors.push(`Línea ${n}: ${conversion.error}`);
      return;
    }
    if (product.tracks_expiry && !item.expiresOn) {
      warnings.push({
        code: "sin_vencimiento",
        requiresAck: false,
        message: `Línea ${n}: "${product.name}" controla vencimientos y no se indicó la fecha de vencimiento.`,
      });
    }
    const before = running.get(product.id) ?? product.current_stock;
    const after = round3(before + conversion.baseQuantity);
    running.set(product.id, after);
    lines.push({
      index,
      productId: product.id,
      productName: product.name,
      description: item.description ?? product.name,
      quantity: item.quantity,
      unitLabel: conversion.unitLabel,
      baseQuantity: conversion.baseQuantity,
      baseUnit: product.base_unit,
      lineTotal,
      effectiveUnitCost: null,
      stockBefore: before,
      stockAfter: after,
    });
  });

  if (!lines.some((l) => l.productId) && errors.length === 0) {
    warnings.push({
      code: "sin_inventario",
      requiresAck: false,
      message: "Ninguna línea incorpora productos al inventario: quizás corresponda registrarlo como gasto general.",
    });
  }

  const allPriced = lines.length > 0 && lines.every((l) => l.lineTotal !== null);
  const sumLines = allPriced ? round2(lines.reduce((acc, l) => acc + (l.lineTotal ?? 0), 0)) : null;
  const taxes = round2((input.taxAmount ?? 0) + (input.otherTaxes ?? 0));
  let total: number | null = input.total ?? null;
  if (total === null && sumLines !== null) total = round2(sumLines + taxes);
  if (total !== null && sumLines !== null && input.total !== null && input.total !== undefined) {
    const expected = round2(sumLines + taxes);
    if (Math.abs(expected - total) > Math.max(1, total * 0.01)) {
      warnings.push({
        code: "total_no_coincide",
        requiresAck: true,
        message: `El total (${formatARS(total)}) no coincide con la suma de las líneas${taxes ? " más impuestos" : ""} (${formatARS(expected)}).`,
      });
    }
  }
  // Costo efectivo: el total (con impuestos y descuentos) se reparte proporcionalmente entre las líneas.
  const factor = total !== null && sumLines !== null && sumLines > 0 ? total / sumLines : 1;
  for (const l of lines) {
    if (l.productId && l.lineTotal !== null && l.baseQuantity) {
      l.effectiveUnitCost = Math.round(((l.lineTotal * factor) / l.baseQuantity) * 10000) / 10000;
    }
  }
  const status = total === null ? "pendiente_precio" : "registrada";
  if (status === "pendiente_precio") {
    warnings.push({
      code: "precio_pendiente",
      requiresAck: false,
      message: "Faltan precios: la compra quedará pendiente de completar. El stock se actualiza igual.",
    });
  }

  // Proveedor y duplicados.
  let supplier: PurchasePlan["supplier"] = { id: input.supplierId ?? null, name: null, isNew: false };
  if (input.supplierId) {
    const [s] = await q.query<{ name: string }>("select name from suppliers where id = $1 and archived_at is null", [input.supplierId]);
    if (!s) errors.push("El proveedor elegido no existe o está archivado.");
    else supplier.name = s.name;
  } else if (input.supplierName || input.supplierCuit) {
    const existing = await findSupplierExact(q, input.supplierName ?? null, input.supplierCuit ?? null);
    supplier = existing
      ? { id: existing.id, name: existing.name, isNew: false }
      : { id: null, name: input.supplierName ?? null, isNew: true };
    if (!existing && !input.supplierName) errors.push("Indicá el nombre del proveedor.");
  }
  const docNumber = normalizeDocNumber(input.docNumber);
  if (supplier.id && docNumber) {
    const dup = await q.query<{ number: number }>(
      `select number from purchases where supplier_id = $1 and coalesce(doc_type, '') = coalesce($2, '') and doc_number = $3 and status <> 'anulada'`,
      [supplier.id, input.docType ?? null, docNumber],
    );
    if (dup.length) {
      errors.push(`Ese comprobante (${docNumber}) ya está registrado en la compra #${dup[0].number} de ${supplier.name}.`);
    }
  }
  if (supplier.id && total !== null) {
    const similar = await q.query<{ number: number }>(
      `select number from purchases where supplier_id = $1 and purchase_date = $2 and total = $3::numeric and status <> 'anulada' limit 1`,
      [supplier.id, input.purchaseDate, toDecimalString(total, 2)],
    );
    if (similar.length) {
      warnings.push({
        code: "posible_duplicado",
        requiresAck: true,
        message: `Ya hay una compra de ${supplier.name} del ${formatDate(input.purchaseDate)} por ${formatARS(total)} (compra #${similar[0].number}). ¿Es otra distinta?`,
      });
    }
  }

  const sameFile = await sameFileRegisteredWarning(q, input.documentId);
  if (sameFile) warnings.push(sameFile);

  return { ok: errors.length === 0, errors, warnings, lines, sumLines, total, status, supplier };
}

async function snapshotProducts(q: Queryable, ids: string[]): Promise<Map<string, LockedProduct>> {
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

export async function previewPurchase(db: Database, raw: CreatePurchaseInput) {
  return planPurchase(db, createPurchaseSchema.parse(raw));
}

function weightedCost(oldStock: number, oldCost: number | null, addQty: number, addCost: number): number {
  if (oldCost === null || oldStock <= 0) return addCost;
  return Math.round(((oldStock * oldCost + addQty * addCost) / (oldStock + addQty)) * 10000) / 10000;
}

export async function createPurchase(db: Database, raw: CreatePurchaseInput, ctx: ActionContext) {
  const input = createPurchaseSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const productIds = input.items.map((i) => i.productId).filter((id): id is string => Boolean(id));
      const products = await lockProductsForStock(tx, productIds);
      const plan = await planPurchase(tx, input, products);
      const summary = `Compra${plan.supplier.name ? ` a ${plan.supplier.name}` : ""}${plan.total !== null ? ` por ${formatARS(plan.total)}` : " (precio pendiente)"}`;
      return withOperation(tx, ctx, { kind: "compra", summary }, async (operationId) => {
        if (!plan.ok) throw new DomainError("compra_invalida", plan.errors.join(" "), { details: { errors: plan.errors } });
        if (!input.acknowledgeWarnings && plan.warnings.some((w) => w.requiresAck)) throw new ConfirmationRequiredError(plan.warnings);

        const supplierId = await resolveOrCreateSupplier(tx, ctx, operationId, {
          supplierId: input.supplierId,
          supplierName: input.supplierName,
          supplierCuit: input.supplierCuit,
        });
        const [purchase] = await tx.query<{ id: string; number: number }>(
          `insert into purchases (supplier_id, purchase_date, doc_type, doc_number, subtotal, tax_amount, other_taxes, total, status,
             notes, source, document_id, operation_id, actor)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id, number`,
          [
            supplierId,
            input.purchaseDate,
            input.docType ?? null,
            normalizeDocNumber(input.docNumber),
            plan.sumLines === null ? null : toDecimalString(plan.sumLines, 2),
            input.taxAmount === null || input.taxAmount === undefined ? null : toDecimalString(input.taxAmount, 2),
            input.otherTaxes === null || input.otherTaxes === undefined ? null : toDecimalString(input.otherTaxes, 2),
            plan.total === null ? null : toDecimalString(plan.total, 2),
            plan.status,
            input.notes ?? null,
            ctx.source,
            input.documentId ?? null,
            operationId,
            ctx.actor ?? null,
          ],
        );

        const movements: { id: string; number: number }[] = [];
        for (const line of plan.lines) {
          const item = input.items[line.index];
          const [pi] = await tx.query<{ id: string }>(
            `insert into purchase_items (purchase_id, position, product_id, description, quantity, unit, base_quantity, unit_price,
               line_total, lot_code, expires_on)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
            [
              purchase.id,
              line.index + 1,
              line.productId,
              line.description || line.productName || "Sin descripción",
              toDecimalString(line.quantity),
              line.unitLabel || "unidad",
              line.baseQuantity === null ? null : toDecimalString(line.baseQuantity),
              item.unitPrice === null || item.unitPrice === undefined ? null : toDecimalString(item.unitPrice, 2),
              line.lineTotal === null ? null : toDecimalString(line.lineTotal, 2),
              item.lotCode ?? null,
              item.expiresOn ?? null,
            ],
          );
          if (!line.productId || !line.baseQuantity) continue;
          const product = products.get(line.productId)!;
          const oldStock = product.current_stock;
          const applied = await applyStockChange(tx, ctx, operationId, {
            product,
            delta: line.baseQuantity,
            kind: "compra",
            inputQuantity: line.quantity,
            inputUnit: line.unitLabel,
            unitCost: line.effectiveUnitCost,
            reason: `Compra #${purchase.number}${plan.supplier.name ? ` · ${plan.supplier.name}` : ""}`,
            purchaseId: purchase.id,
            purchaseItemId: pi.id,
            lot: { lotCode: item.lotCode ?? null, expiresOn: item.expiresOn ?? null },
            effectiveDate: input.purchaseDate,
          });
          movements.push(...applied.map((a) => ({ id: a.id, number: a.number })));
          if (line.effectiveUnitCost !== null) {
            const newCost = weightedCost(oldStock, product.unit_cost, line.baseQuantity, line.effectiveUnitCost);
            await tx.query("update products set unit_cost = $2, updated_at = now() where id = $1", [product.id, toDecimalString(newCost, 4)]);
            product.unit_cost = newCost;
          }
          if (item.learnAlias && normalizeName(item.learnAlias)) {
            await tx.query(
              `insert into product_aliases (product_id, alias_normalized, supplier_id)
               values ($1, $2, $3)
               on conflict (alias_normalized, (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)))
               do update set product_id = excluded.product_id`,
              [product.id, normalizeName(item.learnAlias), supplierId],
            );
          }
        }

        if (input.documentId) {
          await tx.query(
            "update documents set status = 'registrado', linked_purchase_id = $2, updated_at = now() where id = $1",
            [input.documentId, purchase.id],
          );
        }
        await audit(tx, ctx, {
          entityType: "compra",
          entityId: purchase.id,
          action: "registrar",
          details: { numero: purchase.number, total: plan.total, estado: plan.status, lineas: input.items.length },
          operationId,
        });
        return { purchaseId: purchase.id, number: purchase.number, status: plan.status, total: plan.total, movements };
      });
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export const completePricesSchema = z.object({
  items: z.array(z.object({ itemId: uuid, lineTotal: money })).min(1),
  taxAmount: money.nullable().optional(),
  otherTaxes: money.nullable().optional(),
  total: money.nullable().optional(),
});

/** Completa los precios de una compra registrada como "pendiente de precio". */
export async function completePurchasePrices(db: Database, purchaseId: string, raw: z.input<typeof completePricesSchema>, ctx: ActionContext) {
  const input = completePricesSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [purchase] = await tx.query<{ id: string; number: number; status: string }>(
      "select id, number, status from purchases where id = $1 for update",
      [purchaseId],
    );
    if (!purchase) throw new NotFoundError("La compra");
    if (purchase.status !== "pendiente_precio") throw new DomainError("estado_invalido", "La compra no está pendiente de precio.");
    const items = await tx.query<{ id: string; product_id: string | null; base_quantity: string | null; line_total: string | null }>(
      "select id, product_id, base_quantity, line_total from purchase_items where purchase_id = $1 order by position",
      [purchaseId],
    );
    const updates = new Map(input.items.map((i) => [i.itemId, round2(i.lineTotal)]));
    for (const item of items) {
      if (!updates.has(item.id) && item.line_total === null) {
        throw new DomainError("precio_faltante", "Completá el importe de todas las líneas.");
      }
    }
    const lineTotals = items.map((i) => updates.get(i.id) ?? toNumber(i.line_total));
    const sumLines = round2(lineTotals.reduce((a, b) => a + b, 0));
    const total = input.total ?? round2(sumLines + (input.taxAmount ?? 0) + (input.otherTaxes ?? 0));
    const factor = sumLines > 0 ? total / sumLines : 1;
    return (
      await withOperation(tx, ctx, { kind: "completar_precios", summary: `Precios de la compra #${purchase.number}` }, async (operationId) => {
        const productIds = items.map((i) => i.product_id).filter((id): id is string => Boolean(id));
        const products = await lockProductsForStock(tx, productIds);
        for (const [idx, item] of items.entries()) {
          const lineTotal = lineTotals[idx];
          await tx.query("update purchase_items set line_total = $2 where id = $1", [item.id, toDecimalString(lineTotal, 2)]);
          if (!item.product_id || !item.base_quantity) continue;
          const product = products.get(item.product_id);
          if (!product) continue;
          const baseQty = toNumber(item.base_quantity);
          const cost = Math.round(((lineTotal * factor) / baseQty) * 10000) / 10000;
          const newCost = weightedCost(Math.max(product.current_stock - baseQty, 0), product.unit_cost, baseQty, cost);
          await tx.query("update products set unit_cost = $2, updated_at = now() where id = $1", [product.id, toDecimalString(newCost, 4)]);
        }
        await tx.query(
          `update purchases set subtotal = $2, tax_amount = $3, other_taxes = $4, total = $5, status = 'registrada', updated_at = now()
           where id = $1`,
          [
            purchaseId,
            toDecimalString(sumLines, 2),
            input.taxAmount === null || input.taxAmount === undefined ? null : toDecimalString(input.taxAmount, 2),
            input.otherTaxes === null || input.otherTaxes === undefined ? null : toDecimalString(input.otherTaxes, 2),
            toDecimalString(total, 2),
          ],
        );
        await audit(tx, ctx, { entityType: "compra", entityId: purchaseId, action: "completar_precios", details: { total }, operationId });
        return { purchaseId, total };
      })
    ).result;
  });
}

export async function voidPurchase(db: Database, purchaseId: string, reason: string, ctx: ActionContext) {
  const why = reason.trim();
  if (why.length < 3) throw new DomainError("motivo_requerido", "Indicá el motivo de la anulación.");
  try {
    return await db.transaction(async (tx) => {
      const [purchase] = await tx.query<{ id: string; number: number; status: string; document_id: string | null }>(
        "select id, number, status, document_id from purchases where id = $1 for update",
        [purchaseId],
      );
      if (!purchase) throw new NotFoundError("La compra");
      if (purchase.status === "anulada") throw new DomainError("ya_anulada", `La compra #${purchase.number} ya está anulada.`);
      return withOperation(tx, ctx, { kind: "anular_compra", summary: `Anulación de la compra #${purchase.number}` }, async (operationId) => {
        const movements = await tx.query<{ id: string; product_id: string; quantity: string; lot_id: string | null; number: number }>(
          `select m.id, m.product_id, m.quantity, m.lot_id, m.number from stock_movements m
           where m.purchase_id = $1 and m.kind = 'compra'
             and not exists (select 1 from stock_movements r where r.reverses_movement_id = m.id)
           order by m.number`,
          [purchaseId],
        );
        const products = await lockProductsForStock(tx, movements.map((m) => m.product_id));
        const reversals: number[] = [];
        for (const m of movements) {
          const product = products.get(m.product_id)!;
          const qty = toNumber(m.quantity);
          if (product.current_stock < qty) {
            throw new DomainError(
              "stock_insuficiente",
              `No se puede anular: de "${product.name}" quedan ${formatQuantity(product.current_stock, product.base_unit)} y la compra incorporó ${formatQuantity(qty, product.base_unit)} (ya se consumió una parte). Registrá un ajuste si corresponde.`,
            );
          }
          const applied = await applyStockChange(tx, ctx, operationId, {
            product,
            delta: -qty,
            kind: "reversion",
            reason: `Anulación de la compra #${purchase.number}: ${why}`,
            reversesMovementId: m.id,
            unitCost: product.unit_cost,
            lot: m.lot_id ? { lotId: m.lot_id } : null,
          });
          reversals.push(...applied.map((a) => a.number));
        }
        await tx.query(
          "update purchases set status = 'anulada', voided_at = now(), void_reason = $2, updated_at = now() where id = $1",
          [purchaseId, why],
        );
        if (purchase.document_id) {
          await tx.query("update documents set status = 'analizado', linked_purchase_id = null, updated_at = now() where id = $1", [
            purchase.document_id,
          ]);
        }
        await audit(tx, ctx, {
          entityType: "compra",
          entityId: purchaseId,
          action: "anular",
          details: { numero: purchase.number, motivo: why, reversiones: reversals },
          operationId,
        });
        return { purchaseId, reversals };
      });
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export interface PurchaseSummary {
  id: string;
  number: number;
  purchaseDate: string;
  supplierId: string | null;
  supplierName: string | null;
  docType: DocType | null;
  docNumber: string | null;
  total: number | null;
  status: "registrada" | "pendiente_precio" | "anulada";
  source: string;
  itemCount: number;
  createdAt: string;
  documentId: string | null;
}

export interface PurchaseFilters {
  id?: string | null;
  from?: string | null;
  to?: string | null;
  supplierId?: string | null;
  status?: string | null;
  productId?: string | null;
  limit?: number;
}

export async function listPurchases(q: Queryable, filters: PurchaseFilters = {}): Promise<PurchaseSummary[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.id && uuid.safeParse(filters.id).success) add("pu.id = ?", filters.id);
  if (filters.from) add("pu.purchase_date >= ?::date", filters.from);
  if (filters.to) add("pu.purchase_date <= ?::date", filters.to);
  if (filters.supplierId && uuid.safeParse(filters.supplierId).success) add("pu.supplier_id = ?", filters.supplierId);
  if (filters.status) add("pu.status = ?", filters.status);
  if (filters.productId && uuid.safeParse(filters.productId).success) {
    add("exists (select 1 from purchase_items x where x.purchase_id = pu.id and x.product_id = ?)", filters.productId);
  }
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
  const rows = await q.query<{
    id: string;
    number: number;
    purchase_date: string;
    supplier_id: string | null;
    supplier_name: string | null;
    doc_type: DocType | null;
    doc_number: string | null;
    total: string | null;
    status: PurchaseSummary["status"];
    source: string;
    item_count: number;
    created_at: string;
    document_id: string | null;
  }>(
    `select pu.id, pu.number, pu.purchase_date, pu.supplier_id, s.name as supplier_name, pu.doc_type, pu.doc_number, pu.total,
       pu.status, pu.source, (select count(*)::int from purchase_items i where i.purchase_id = pu.id) as item_count,
       pu.created_at, pu.document_id
     from purchases pu left join suppliers s on s.id = pu.supplier_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by pu.purchase_date desc, pu.number desc limit ${limit}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    purchaseDate: r.purchase_date,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    docType: r.doc_type,
    docNumber: r.doc_number,
    total: toNumberOrNull(r.total),
    status: r.status,
    source: r.source,
    itemCount: r.item_count,
    createdAt: r.created_at,
    documentId: r.document_id,
  }));
}

export interface PurchaseDetail extends PurchaseSummary {
  subtotal: number | null;
  taxAmount: number | null;
  otherTaxes: number | null;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  actor: string | null;
  items: {
    id: string;
    position: number;
    productId: string | null;
    productName: string | null;
    baseUnit: BaseUnit | null;
    description: string;
    quantity: number;
    unit: string;
    baseQuantity: number | null;
    unitPrice: number | null;
    lineTotal: number | null;
    lotCode: string | null;
    expiresOn: string | null;
  }[];
}

export async function getPurchase(q: Queryable, id: string): Promise<PurchaseDetail | null> {
  if (!uuid.safeParse(id).success) return null;
  const [summary] = await listPurchases(q, { id, limit: 1 });
  if (!summary) return null;
  const [extra] = await q.query<{
    subtotal: string | null;
    tax_amount: string | null;
    other_taxes: string | null;
    notes: string | null;
    voided_at: string | null;
    void_reason: string | null;
    actor: string | null;
  }>("select subtotal, tax_amount, other_taxes, notes, voided_at, void_reason, actor from purchases where id = $1", [id]);
  const items = await q.query<{
    id: string;
    position: number;
    product_id: string | null;
    product_name: string | null;
    base_unit: BaseUnit | null;
    description: string;
    quantity: string;
    unit: string;
    base_quantity: string | null;
    unit_price: string | null;
    line_total: string | null;
    lot_code: string | null;
    expires_on: string | null;
  }>(
    `select i.id, i.position, i.product_id, p.name as product_name, p.base_unit, i.description, i.quantity, i.unit, i.base_quantity,
       i.unit_price, i.line_total, i.lot_code, i.expires_on
     from purchase_items i left join products p on p.id = i.product_id where i.purchase_id = $1 order by i.position`,
    [id],
  );
  return {
    ...summary,
    subtotal: toNumberOrNull(extra.subtotal),
    taxAmount: toNumberOrNull(extra.tax_amount),
    otherTaxes: toNumberOrNull(extra.other_taxes),
    notes: extra.notes,
    voidedAt: extra.voided_at,
    voidReason: extra.void_reason,
    actor: extra.actor,
    items: items.map((i) => ({
      id: i.id,
      position: i.position,
      productId: i.product_id,
      productName: i.product_name,
      baseUnit: i.base_unit,
      description: i.description,
      quantity: toNumber(i.quantity),
      unit: i.unit,
      baseQuantity: toNumberOrNull(i.base_quantity),
      unitPrice: toNumberOrNull(i.unit_price),
      lineTotal: toNumberOrNull(i.line_total),
      lotCode: i.lot_code,
      expiresOn: i.expires_on,
    })),
  };
}

export { normalizeCuit };
