"use server";

import { cookies } from "next/headers";
import { getActionContext } from "@/lib/auth/server";
import { ACTOR_COOKIE, SESSION_MAX_AGE_SECONDS, sanitizeActorName } from "@/lib/auth/session";
import { isProductionRuntime } from "@/lib/config";
import { getDb } from "@/lib/db";
import { parseDecimalAR } from "@/lib/domain/numbers";
import { runAction } from "@/lib/server/action";
import type { Source } from "@/lib/services/context";
import { DomainError } from "@/lib/services/errors";
import { createExpense, type CreateExpenseInput, voidExpense } from "@/lib/services/expenses";
import {
  adjustStock,
  type AdjustStockInput,
  registerMovements,
  type RegisterMovementsInput,
  reverseMovement,
} from "@/lib/services/movements";
import {
  addPresentation,
  archivePresentation,
  archiveProduct,
  createProduct,
  type CreateProductInput,
  unarchiveProduct,
  updateProduct,
  type UpdateProductInput,
} from "@/lib/services/products";
import { completePurchasePrices, createPurchase, type CreatePurchaseInput, voidPurchase } from "@/lib/services/purchases";
import { archiveSupplier, createSupplier, updateSupplier } from "@/lib/services/suppliers";

type Num = number | string | null | undefined;

/** Convierte números escritos en formato argentino ("1.234,5") a number. */
function num(value: Num, field: string): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : parseDecimalAR(value);
  if (n === null || !Number.isFinite(n)) throw new DomainError("numero_invalido", `${field}: "${value}" no es un número válido.`);
  return n;
}

function numOrNull(value: Num, field: string): number | null {
  return num(value, field) ?? null;
}

const allowedSource = (s: unknown): Source => (s === "texto" || s === "voz" ? s : "manual");

// ---------- Productos ----------

export interface ProductFormValues {
  name: string;
  category?: string | null;
  description?: string | null;
  baseUnit: string;
  minStock?: Num;
  unitCost?: Num;
  tracksExpiry?: boolean;
  barcode?: string | null;
  initialStock?: Num;
  initialLotCode?: string | null;
  initialExpiresOn?: string | null;
  presentations?: { name: string; factor: Num }[];
  acknowledgeSimilar?: boolean;
  idempotencyKey?: string;
  source?: Source;
}

export async function createProductAction(values: ProductFormValues) {
  return runAction(
    async () => {
      const ctx = await getActionContext(allowedSource(values.source), values.idempotencyKey);
      const input: CreateProductInput = {
        name: values.name,
        category: values.category ?? null,
        description: values.description ?? null,
        baseUnit: values.baseUnit as CreateProductInput["baseUnit"],
        minStock: num(values.minStock, "Stock mínimo") ?? 0,
        unitCost: numOrNull(values.unitCost, "Costo"),
        tracksExpiry: Boolean(values.tracksExpiry),
        barcode: values.barcode ?? null,
        initialStock: num(values.initialStock, "Stock inicial") ?? 0,
        initialLotCode: values.initialLotCode ?? null,
        initialExpiresOn: values.initialExpiresOn || null,
        presentations: (values.presentations ?? [])
          .filter((p) => p.name?.trim())
          .map((p) => ({ name: p.name, factor: num(p.factor, `Equivalencia de ${p.name}`) ?? 0 })),
        acknowledgeSimilar: Boolean(values.acknowledgeSimilar),
      };
      const out = await createProduct(await getDb(), input, ctx);
      return out.result;
    },
    { message: "Producto creado." },
  );
}

export async function updateProductAction(id: string, values: Omit<ProductFormValues, "initialStock" | "presentations">) {
  return runAction(
    async () => {
      const ctx = await getActionContext("manual");
      const input: UpdateProductInput = {
        name: values.name,
        category: values.category ?? null,
        description: values.description ?? null,
        baseUnit: values.baseUnit as UpdateProductInput["baseUnit"],
        minStock: num(values.minStock, "Stock mínimo") ?? 0,
        unitCost: numOrNull(values.unitCost, "Costo"),
        tracksExpiry: Boolean(values.tracksExpiry),
        barcode: values.barcode ?? null,
        acknowledgeSimilar: Boolean(values.acknowledgeSimilar),
      };
      return updateProduct(await getDb(), id, input, ctx);
    },
    { message: "Cambios guardados." },
  );
}

export async function archiveProductAction(id: string, reason: string) {
  return runAction(async () => archiveProduct(await getDb(), id, reason, await getActionContext("manual")), {
    message: "Producto archivado. Su historial se conserva.",
  });
}

export async function unarchiveProductAction(id: string) {
  return runAction(async () => unarchiveProduct(await getDb(), id, await getActionContext("manual")), {
    message: "Producto reactivado.",
  });
}

export async function addPresentationAction(productId: string, name: string, factor: Num) {
  return runAction(
    async () =>
      addPresentation(await getDb(), productId, { name, factor: num(factor, "Equivalencia") ?? 0 }, await getActionContext("manual")),
    { message: "Presentación agregada." },
  );
}

export async function archivePresentationAction(presentationId: string) {
  return runAction(async () => archivePresentation(await getDb(), presentationId, await getActionContext("manual")), {
    message: "Presentación quitada.",
  });
}

// ---------- Movimientos ----------

export interface MovementFormValues {
  items: {
    productId: string;
    quantity: Num;
    unit?: string | null;
    kind: "consumo" | "ingreso";
    reason?: string | null;
    lotId?: string | null;
    lotCode?: string | null;
    expiresOn?: string | null;
  }[];
  effectiveDate?: string | null;
  acknowledgeWarnings?: boolean;
  idempotencyKey?: string;
  source?: Source;
}

export async function registerMovementsAction(values: MovementFormValues) {
  return runAction(
    async () => {
      const ctx = await getActionContext(allowedSource(values.source), values.idempotencyKey);
      const input: RegisterMovementsInput = {
        items: values.items.map((i) => ({
          productId: i.productId,
          quantity: num(i.quantity, "Cantidad") ?? 0,
          unit: i.unit ?? null,
          kind: i.kind,
          reason: i.reason ?? null,
          lotId: i.lotId || null,
          lotCode: i.lotCode ?? null,
          expiresOn: i.expiresOn || null,
        })),
        effectiveDate: values.effectiveDate || null,
        acknowledgeWarnings: Boolean(values.acknowledgeWarnings),
      };
      const out = await registerMovements(await getDb(), input, ctx);
      return { ...out.result, duplicate: out.duplicate };
    },
    { message: "Movimiento registrado." },
  );
}

export async function adjustStockAction(values: {
  productId: string;
  newStock: Num;
  reason: string;
  lotId?: string | null;
  acknowledgeWarnings?: boolean;
  idempotencyKey?: string;
  source?: Source;
}) {
  return runAction(
    async () => {
      const ctx = await getActionContext(allowedSource(values.source), values.idempotencyKey);
      const input: AdjustStockInput = {
        productId: values.productId,
        newStock: num(values.newStock, "Stock contado") ?? -1,
        reason: values.reason,
        lotId: values.lotId || null,
        acknowledgeWarnings: Boolean(values.acknowledgeWarnings),
      };
      return (await adjustStock(await getDb(), input, ctx)).result;
    },
    { message: "Ajuste registrado." },
  );
}

export async function reverseMovementAction(values: { movementId: string; reason: string; idempotencyKey?: string; source?: Source }) {
  return runAction(
    async () => {
      const ctx = await getActionContext(allowedSource(values.source), values.idempotencyKey);
      return (await reverseMovement(await getDb(), { movementId: values.movementId, reason: values.reason }, ctx)).result;
    },
    { message: "Movimiento revertido." },
  );
}

// ---------- Compras ----------

export interface PurchaseFormValues {
  supplierId?: string | null;
  supplierName?: string | null;
  supplierCuit?: string | null;
  purchaseDate: string;
  docType?: string | null;
  docNumber?: string | null;
  items: {
    productId?: string | null;
    description?: string | null;
    quantity: Num;
    unit?: string | null;
    unitPrice?: Num;
    lineTotal?: Num;
    lotCode?: string | null;
    expiresOn?: string | null;
    learnAlias?: string | null;
  }[];
  taxAmount?: Num;
  otherTaxes?: Num;
  total?: Num;
  notes?: string | null;
  documentId?: string | null;
  acknowledgeWarnings?: boolean;
  idempotencyKey?: string;
  source?: Source | "factura";
}

export async function createPurchaseAction(values: PurchaseFormValues) {
  return runAction(
    async () => {
      const source: Source = values.source === "factura" ? "factura" : allowedSource(values.source);
      const ctx = await getActionContext(source, values.idempotencyKey);
      const input: CreatePurchaseInput = {
        supplierId: values.supplierId || null,
        supplierName: values.supplierName ?? null,
        supplierCuit: values.supplierCuit ?? null,
        purchaseDate: values.purchaseDate,
        docType: (values.docType || null) as CreatePurchaseInput["docType"],
        docNumber: values.docNumber ?? null,
        items: values.items.map((i, idx) => ({
          productId: i.productId || null,
          description: i.description ?? null,
          quantity: num(i.quantity, `Línea ${idx + 1}, cantidad`) ?? 0,
          unit: i.unit ?? null,
          unitPrice: numOrNull(i.unitPrice, `Línea ${idx + 1}, precio unitario`),
          lineTotal: numOrNull(i.lineTotal, `Línea ${idx + 1}, importe`),
          lotCode: i.lotCode ?? null,
          expiresOn: i.expiresOn || null,
          learnAlias: i.learnAlias ?? null,
        })),
        taxAmount: numOrNull(values.taxAmount, "Impuestos"),
        otherTaxes: numOrNull(values.otherTaxes, "Otros impuestos"),
        total: numOrNull(values.total, "Total"),
        notes: values.notes ?? null,
        documentId: values.documentId || null,
        acknowledgeWarnings: Boolean(values.acknowledgeWarnings),
      };
      const out = await createPurchase(await getDb(), input, ctx);
      return { ...out.result, duplicate: out.duplicate };
    },
    { message: "Compra registrada." },
  );
}

export async function completePurchasePricesAction(purchaseId: string, values: { items: { itemId: string; lineTotal: Num }[]; taxAmount?: Num; otherTaxes?: Num; total?: Num }) {
  return runAction(
    async () =>
      completePurchasePrices(
        await getDb(),
        purchaseId,
        {
          items: values.items.map((i) => ({ itemId: i.itemId, lineTotal: num(i.lineTotal, "Importe") ?? -1 })),
          taxAmount: numOrNull(values.taxAmount, "Impuestos"),
          otherTaxes: numOrNull(values.otherTaxes, "Otros impuestos"),
          total: numOrNull(values.total, "Total"),
        },
        await getActionContext("manual"),
      ),
    { message: "Precios completados." },
  );
}

export async function voidPurchaseAction(purchaseId: string, reason: string) {
  return runAction(async () => (await voidPurchase(await getDb(), purchaseId, reason, await getActionContext("manual"))).result, {
    message: "Compra anulada. El stock incorporado se revirtió.",
  });
}

// ---------- Gastos ----------

export interface ExpenseFormValues {
  expenseDate: string;
  category: string;
  description: string;
  amount: Num;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierCuit?: string | null;
  docType?: string | null;
  docNumber?: string | null;
  notes?: string | null;
  documentId?: string | null;
  acknowledgeWarnings?: boolean;
  idempotencyKey?: string;
  source?: Source | "factura";
}

export async function createExpenseAction(values: ExpenseFormValues) {
  return runAction(
    async () => {
      const source: Source = values.source === "factura" ? "factura" : allowedSource(values.source);
      const ctx = await getActionContext(source, values.idempotencyKey);
      const input: CreateExpenseInput = {
        expenseDate: values.expenseDate,
        category: values.category,
        description: values.description,
        amount: num(values.amount, "Importe") ?? 0,
        supplierId: values.supplierId || null,
        supplierName: values.supplierName ?? null,
        supplierCuit: values.supplierCuit ?? null,
        docType: (values.docType || null) as CreateExpenseInput["docType"],
        docNumber: values.docNumber ?? null,
        notes: values.notes ?? null,
        documentId: values.documentId || null,
        acknowledgeWarnings: Boolean(values.acknowledgeWarnings),
      };
      const out = await createExpense(await getDb(), input, ctx);
      return { ...out.result, duplicate: out.duplicate };
    },
    { message: "Gasto registrado." },
  );
}

export async function voidExpenseAction(id: string, reason: string) {
  return runAction(async () => voidExpense(await getDb(), id, reason, await getActionContext("manual")), {
    message: "Gasto anulado.",
  });
}

// ---------- Proveedores ----------

export interface SupplierFormValues {
  name: string;
  cuit?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export async function createSupplierAction(values: SupplierFormValues) {
  return runAction(async () => (await createSupplier(await getDb(), values, await getActionContext("manual"))).result, {
    message: "Proveedor creado.",
  });
}

export async function updateSupplierAction(id: string, values: SupplierFormValues) {
  return runAction(async () => updateSupplier(await getDb(), id, values, await getActionContext("manual")), {
    message: "Proveedor actualizado.",
  });
}

export async function archiveSupplierAction(id: string) {
  return runAction(async () => archiveSupplier(await getDb(), id, await getActionContext("manual")), {
    message: "Proveedor archivado.",
  });
}

// ---------- Dispositivo ----------

export async function setActorNameAction(name: string) {
  return runAction(
    async () => {
      await getActionContext("manual");
      const store = await cookies();
      const actor = sanitizeActorName(name);
      if (actor) {
        store.set(ACTOR_COOKIE, encodeURIComponent(actor), {
          httpOnly: false,
          secure: isProductionRuntime(),
          sameSite: "lax",
          path: "/",
          maxAge: SESSION_MAX_AGE_SECONDS,
        });
      } else {
        store.delete(ACTOR_COOKIE);
      }
      return { actor };
    },
    { message: "Nombre actualizado." },
  );
}
