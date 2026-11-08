import { randomUUID } from "node:crypto";
import type { Queryable } from "@/lib/db/types";
import { formatARS, formatDate, formatNumber, formatQuantity, todayAR } from "@/lib/domain/format";
import { findNearDuplicates } from "@/lib/domain/matching";
import { quantityUnitLabel, resolvePhysicalUnit, toBaseQuantity, UNIT_DEFS, unitLabel } from "@/lib/domain/units";
import { planExpense } from "@/lib/services/expenses";
import { createExpenseSchema } from "@/lib/services/expenses";
import { getMovement, planAdjustment, planMovements, planReversal, registerMovementsSchema } from "@/lib/services/movements";
import { getProduct, listProducts } from "@/lib/services/products";
import { createPurchaseSchema, planPurchase } from "@/lib/services/purchases";
import { MOVEMENT_KIND_LABELS } from "@/lib/services/types";
import type {
  AdjustProposalInput,
  ExpenseProposalInput,
  MovementProposalInput,
  PresentationProposalInput,
  ProductProposalInput,
  Proposal,
  PurchaseProposalInput,
  ReversalProposalInput,
} from "./types";

/** Resultado de preparar una propuesta: válida (se muestra al usuario) o con errores (se le explican). */
export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; errors: string[] };

function signed(kind: "consumo" | "ingreso", qty: number, unit: Parameters<typeof formatQuantity>[1]) {
  return `${kind === "consumo" ? "−" : "+"}${formatQuantity(qty, unit)}`;
}

export async function proposeMovements(q: Queryable, input: MovementProposalInput): Promise<ProposalResult> {
  const parsed = registerMovementsSchema.safeParse({ ...input, acknowledgeWarnings: false });
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const plan = await planMovements(q, parsed.data);
  if (!plan.ok) return { ok: false, errors: plan.errors };
  const lines = plan.lines.map((l) => ({
    productId: l.productId,
    productName: l.productName,
    baseUnit: l.baseUnit,
    kind: l.kind,
    inputLabel: `${formatNumber(l.inputQuantity)} ${quantityUnitLabel(l.inputQuantity, l.inputUnit)}`,
    baseQuantity: l.baseQuantity,
    stockBefore: l.stockBefore,
    stockAfter: l.stockAfter,
    statusAfter: l.statusAfter,
  }));
  const kinds = new Set(lines.map((l) => l.kind));
  const title =
    kinds.size === 1
      ? `${kinds.has("consumo") ? "Registrar consumo" : "Registrar ingreso"}${input.effectiveDate && input.effectiveDate !== todayAR() ? ` del ${formatDate(input.effectiveDate)}` : ""}`
      : "Registrar movimientos";
  return { ok: true, proposal: { id: randomUUID(), type: "movimientos", title, input, lines, warnings: plan.warnings } };
}

export async function proposePurchase(q: Queryable, input: PurchaseProposalInput): Promise<ProposalResult> {
  const parsed = createPurchaseSchema.safeParse({
    supplierName: input.supplierName,
    purchaseDate: input.purchaseDate,
    docNumber: input.docNumber,
    items: input.items.map((i) => ({ ...i, unitPrice: i.unitPrice ?? null })),
    total: input.total,
  });
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const plan = await planPurchase(q, parsed.data);
  if (!plan.ok) return { ok: false, errors: plan.errors };
  const lines = plan.lines.map((l) => ({
    label: l.productName ?? l.description,
    productName: l.productName,
    inputLabel: `${formatNumber(l.quantity)} ${quantityUnitLabel(l.quantity, l.unitLabel || "unidad")}${
      l.baseQuantity !== null && l.baseUnit && l.baseQuantity !== l.quantity ? ` (= ${formatQuantity(l.baseQuantity, l.baseUnit)})` : ""
    }`,
    lineTotal: l.lineTotal,
    stockAfter: l.stockAfter,
  }));
  return {
    ok: true,
    proposal: {
      id: randomUUID(),
      type: "compra",
      title: `Registrar compra${plan.supplier.name ? ` a ${plan.supplier.name}` : ""}`,
      input,
      lines,
      total: plan.total,
      pendingPrice: plan.status === "pendiente_precio",
      supplierIsNew: plan.supplier.isNew,
      warnings: plan.warnings,
    },
  };
}

export async function proposeExpense(q: Queryable, input: ExpenseProposalInput): Promise<ProposalResult> {
  const parsed = createExpenseSchema.safeParse({ ...input, acknowledgeWarnings: false });
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const plan = await planExpense(q, parsed.data);
  if (!plan.ok) return { ok: false, errors: plan.errors };
  return {
    ok: true,
    proposal: { id: randomUUID(), type: "gasto", title: `Registrar gasto: ${input.category}`, input, warnings: plan.warnings },
  };
}

export async function proposeProduct(q: Queryable, input: ProductProposalInput): Promise<ProposalResult> {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Falta el nombre del producto.");
  if (!UNIT_DEFS[input.baseUnit]) errors.push("Unidad base inválida.");
  if (input.initialStock < 0 || input.minStock < 0) errors.push("Las cantidades no pueden ser negativas.");
  for (const p of input.presentations) {
    if (!p.name.trim() || !(p.factor > 0)) errors.push(`La presentación "${p.name}" necesita una equivalencia mayor que cero.`);
    if (resolvePhysicalUnit(p.name)) errors.push(`"${p.name}" es una unidad de medida, no una presentación.`);
  }
  if (errors.length) return { ok: false, errors };
  const existing = await listProducts(q);
  const similar = findNearDuplicates(input.name, existing.map((p) => ({ id: p.id, name: p.name })));
  const exact = similar.find((s) => s.exact);
  if (exact) {
    return {
      ok: false,
      errors: [`Ya existe el producto "${exact.candidate.name}" (id ${exact.candidate.id}). Usá ese producto (por ejemplo, registrando un ingreso) en lugar de crear otro.`],
    };
  }
  const warnings = similar.length
    ? [
        {
          code: "producto_similar",
          requiresAck: true,
          message: `Hay productos parecidos: ${similar.map((s) => `"${s.candidate.name}"`).join(", ")}. Confirmá solo si es un producto distinto.`,
        },
      ]
    : [];
  return {
    ok: true,
    proposal: {
      id: randomUUID(),
      type: "producto",
      title: "Crear producto nuevo",
      input,
      similar: similar.map((s) => ({ id: s.candidate.id, name: s.candidate.name })),
      warnings,
    },
  };
}

export async function proposeAdjustment(q: Queryable, input: AdjustProposalInput): Promise<ProposalResult> {
  try {
    const plan = await planAdjustment(q, { ...input, lotId: null, acknowledgeWarnings: false });
    if (!plan.ok) return { ok: false, errors: plan.errors };
    return {
      ok: true,
      proposal: {
        id: randomUUID(),
        type: "ajuste",
        title: `Ajustar stock de ${plan.line.productName}`,
        input,
        productName: plan.line.productName,
        baseUnit: plan.line.baseUnit,
        stockBefore: plan.line.stockBefore,
        stockAfter: plan.line.stockAfter,
        warnings: plan.warnings,
      },
    };
  } catch (err) {
    return { ok: false, errors: [(err as Error).message] };
  }
}

export async function proposeReversal(q: Queryable, input: ReversalProposalInput): Promise<ProposalResult> {
  const movement = await getMovement(q, input.movementId);
  if (!movement) return { ok: false, errors: ["No existe ese movimiento."] };
  const plan = await planReversal(q, input.movementId);
  if (!plan.ok) return { ok: false, errors: plan.errors };
  return {
    ok: true,
    proposal: {
      id: randomUUID(),
      type: "reversion",
      title: `Revertir movimiento #${movement.number}`,
      input,
      description: `${MOVEMENT_KIND_LABELS[movement.kind]} de ${formatQuantity(Math.abs(movement.quantity), movement.baseUnit)} de ${movement.productName} (${formatDate(movement.effectiveDate)})`,
      stockBefore: plan.line.stockBefore,
      stockAfter: plan.line.stockAfter,
      baseUnit: movement.baseUnit,
      warnings: [{ code: "reversion", requiresAck: false, message: "El movimiento original queda en el historial; se registra otro de signo contrario." }],
    },
  };
}

export async function proposePresentation(q: Queryable, input: PresentationProposalInput): Promise<ProposalResult> {
  const product = await getProduct(q, input.productId);
  if (!product || product.archivedAt) return { ok: false, errors: ["El producto no existe o está archivado."] };
  if (!(input.factor > 0)) return { ok: false, errors: ["La equivalencia tiene que ser mayor que cero."] };
  if (resolvePhysicalUnit(input.name)) return { ok: false, errors: [`"${input.name}" es una unidad de medida, no una presentación.`] };
  const check = toBaseQuantity({ name: product.name, baseUnit: product.baseUnit, presentations: product.presentations }, 1, input.name);
  if (check.ok && check.kind === "presentacion") {
    return { ok: false, errors: [`"${product.name}" ya tiene la presentación "${input.name}" (= ${formatNumber(check.baseQuantity)} ${unitLabel(product.baseUnit, check.baseQuantity)}).`] };
  }
  return {
    ok: true,
    proposal: {
      id: randomUUID(),
      type: "presentacion",
      title: `Definir presentación de ${product.name}`,
      input,
      productName: product.name,
      baseUnit: product.baseUnit,
      warnings: [],
    },
  };
}

/** Texto breve de la propuesta para el historial de la conversación con el modelo. */
export function describeProposal(p: Proposal): string {
  switch (p.type) {
    case "movimientos":
      return p.lines.map((l) => `${signed(l.kind, l.baseQuantity, l.baseUnit)} ${l.productName} (stock ${formatNumber(l.stockBefore)} → ${formatNumber(l.stockAfter)})`).join("; ");
    case "compra":
      return `${p.lines.map((l) => `${l.inputLabel} ${l.label}`).join("; ")}${p.total !== null ? ` · total ${formatARS(p.total)}` : " · sin precio (pendiente)"}`;
    case "gasto":
      return `${p.input.category}: ${p.input.description} · ${formatARS(p.input.amount)} · ${formatDate(p.input.expenseDate)}`;
    case "producto":
      return `${p.input.name} (${UNIT_DEFS[p.input.baseUnit].plural}), stock inicial ${formatNumber(p.input.initialStock)}`;
    case "ajuste":
      return `${p.productName}: ${formatNumber(p.stockBefore)} → ${formatNumber(p.stockAfter)} (${p.input.reason})`;
    case "reversion":
      return p.description;
    case "presentacion":
      return `1 ${p.input.name} = ${formatNumber(p.input.factor)} ${unitLabel(p.baseUnit, p.input.factor)} (${p.productName})`;
  }
}
