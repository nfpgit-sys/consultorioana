import { z } from "zod";
import type { Database, Queryable } from "@/lib/db/types";
import { formatARS, formatDate } from "@/lib/domain/format";
import { cleanDisplayName } from "@/lib/domain/normalize";
import { toDecimalString, toNumber } from "@/lib/domain/numbers";
import { round2 } from "@/lib/domain/units";
import { type ActionContext, audit, withOperation } from "./context";
import { DOC_TYPES, type DocType } from "./documents-types";
import { DomainError, NotFoundError, translateDbError } from "./errors";
import { ConfirmationRequiredError } from "./movements";
import { sameFileRegisteredWarning } from "./duplicate-files";
import { normalizeDocNumber } from "./purchases";
import { findSupplierExact, resolveOrCreateSupplier } from "./suppliers";
import type { Warning } from "./types";
import { money, optionalText, pastOrTodayDate, uuid } from "./validation";

/** Categorías sugeridas para gastos generales (se pueden escribir otras). */
export const EXPENSE_CATEGORIES = [
  "Alquiler",
  "Expensas",
  "Luz",
  "Gas",
  "Agua",
  "Internet y teléfono",
  "Laboratorio dental",
  "Mantenimiento de equipos",
  "Reparaciones",
  "Limpieza",
  "Sueldos y honorarios",
  "Cargas sociales",
  "Impuestos y tasas",
  "Seguros",
  "Colegio / matrícula",
  "Software y suscripciones",
  "Publicidad",
  "Esterilización / residuos patogénicos",
  "Bancos y comisiones",
  "Capacitación",
  "Viáticos",
  "Librería y oficina",
  "Otros",
];

export const createExpenseSchema = z.object({
  expenseDate: pastOrTodayDate,
  category: z.string().trim().min(1, "Elegí o escribí una categoría.").max(80),
  description: z.string().trim().min(1, "Describí el gasto.").max(300),
  amount: money.refine((v) => v > 0, { message: "El importe tiene que ser mayor que cero." }),
  supplierId: uuid.nullable().optional(),
  supplierName: optionalText(200),
  supplierCuit: optionalText(20),
  docType: z.enum(DOC_TYPES).nullable().optional(),
  docNumber: optionalText(40),
  notes: optionalText(1000),
  documentId: uuid.nullable().optional(),
  acknowledgeWarnings: z.boolean().default(false),
});
export type CreateExpenseInput = z.input<typeof createExpenseSchema>;

export async function planExpense(q: Queryable, input: z.output<typeof createExpenseSchema>) {
  const errors: string[] = [];
  const warnings: Warning[] = [];
  let supplierId = input.supplierId ?? null;
  if (!supplierId && (input.supplierName || input.supplierCuit)) {
    supplierId = (await findSupplierExact(q, input.supplierName ?? null, input.supplierCuit ?? null))?.id ?? null;
  }
  const docNumber = normalizeDocNumber(input.docNumber);
  if (supplierId && docNumber) {
    const dup = await q.query<{ number: number }>(
      `select number from expenses where supplier_id = $1 and coalesce(doc_type, '') = coalesce($2, '') and doc_number = $3 and status <> 'anulado'`,
      [supplierId, input.docType ?? null, docNumber],
    );
    if (dup.length) errors.push(`Ese comprobante (${docNumber}) ya está registrado en el gasto #${dup[0].number}.`);
  }
  const similar = await q.query<{ number: number }>(
    `select number from expenses where expense_date = $1 and amount = $2::numeric and lower(category) = lower($3) and status <> 'anulado' limit 1`,
    [input.expenseDate, toDecimalString(input.amount, 2), input.category],
  );
  if (similar.length) {
    warnings.push({
      code: "posible_duplicado",
      requiresAck: true,
      message: `Ya hay un gasto de "${input.category}" del ${formatDate(input.expenseDate)} por ${formatARS(input.amount)} (gasto #${similar[0].number}). ¿Es otro distinto?`,
    });
  }
  const sameFile = await sameFileRegisteredWarning(q, input.documentId);
  if (sameFile) warnings.push(sameFile);
  return { ok: errors.length === 0, errors, warnings };
}

export async function createExpense(db: Database, raw: CreateExpenseInput, ctx: ActionContext) {
  const input = createExpenseSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const plan = await planExpense(tx, input);
      const summary = `Gasto: ${input.category} ${formatARS(input.amount)}`;
      return withOperation(tx, ctx, { kind: "gasto", summary }, async (operationId) => {
        if (!plan.ok) throw new DomainError("gasto_invalido", plan.errors.join(" "));
        if (!input.acknowledgeWarnings && plan.warnings.some((w) => w.requiresAck)) throw new ConfirmationRequiredError(plan.warnings);
        const supplierId = await resolveOrCreateSupplier(tx, ctx, operationId, input);
        const [row] = await tx.query<{ id: string; number: number }>(
          `insert into expenses (expense_date, category, description, amount, supplier_id, doc_type, doc_number, notes, source,
             document_id, operation_id, actor)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id, number`,
          [
            input.expenseDate,
            cleanDisplayName(input.category),
            cleanDisplayName(input.description),
            toDecimalString(round2(input.amount), 2),
            supplierId,
            input.docType ?? null,
            normalizeDocNumber(input.docNumber),
            input.notes ?? null,
            ctx.source,
            input.documentId ?? null,
            operationId,
            ctx.actor ?? null,
          ],
        );
        if (input.documentId) {
          await tx.query("update documents set status = 'registrado', linked_expense_id = $2, updated_at = now() where id = $1", [
            input.documentId,
            row.id,
          ]);
        }
        await audit(tx, ctx, {
          entityType: "gasto",
          entityId: row.id,
          action: "registrar",
          details: { numero: row.number, categoria: input.category, importe: input.amount },
          operationId,
        });
        return { expenseId: row.id, number: row.number };
      });
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export async function voidExpense(db: Database, id: string, reason: string, ctx: ActionContext) {
  const why = reason.trim();
  if (why.length < 3) throw new DomainError("motivo_requerido", "Indicá el motivo de la anulación.");
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ number: number; status: string; document_id: string | null }>(
      "select number, status, document_id from expenses where id = $1 for update",
      [id],
    );
    if (!row) throw new NotFoundError("El gasto");
    if (row.status === "anulado") throw new DomainError("ya_anulado", `El gasto #${row.number} ya está anulado.`);
    return (
      await withOperation(tx, ctx, { kind: "anular_gasto", summary: `Anulación del gasto #${row.number}` }, async (operationId) => {
        await tx.query("update expenses set status = 'anulado', voided_at = now(), void_reason = $2, updated_at = now() where id = $1", [
          id,
          why,
        ]);
        if (row.document_id) {
          await tx.query("update documents set status = 'analizado', linked_expense_id = null, updated_at = now() where id = $1", [
            row.document_id,
          ]);
        }
        await audit(tx, ctx, { entityType: "gasto", entityId: id, action: "anular", details: { numero: row.number, motivo: why }, operationId });
        return { expenseId: id };
      })
    ).result;
  });
}

export interface Expense {
  id: string;
  number: number;
  expenseDate: string;
  category: string;
  description: string;
  amount: number;
  supplierId: string | null;
  supplierName: string | null;
  docType: DocType | null;
  docNumber: string | null;
  status: "registrado" | "anulado";
  notes: string | null;
  source: string;
  documentId: string | null;
  voidReason: string | null;
  actor: string | null;
  createdAt: string;
}

export interface ExpenseFilters {
  from?: string | null;
  to?: string | null;
  category?: string | null;
  includeVoided?: boolean;
  limit?: number;
}

export async function listExpenses(q: Queryable, filters: ExpenseFilters = {}): Promise<Expense[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filters.from) add("e.expense_date >= ?::date", filters.from);
  if (filters.to) add("e.expense_date <= ?::date", filters.to);
  if (filters.category) add("e.category = ?", filters.category);
  if (!filters.includeVoided) where.push("e.status <> 'anulado'");
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 2000);
  const rows = await q.query<{
    id: string;
    number: number;
    expense_date: string;
    category: string;
    description: string;
    amount: string;
    supplier_id: string | null;
    supplier_name: string | null;
    doc_type: DocType | null;
    doc_number: string | null;
    status: Expense["status"];
    notes: string | null;
    source: string;
    document_id: string | null;
    void_reason: string | null;
    actor: string | null;
    created_at: string;
  }>(
    `select e.id, e.number, e.expense_date, e.category, e.description, e.amount, e.supplier_id, s.name as supplier_name,
       e.doc_type, e.doc_number, e.status, e.notes, e.source, e.document_id, e.void_reason, e.actor, e.created_at
     from expenses e left join suppliers s on s.id = e.supplier_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by e.expense_date desc, e.number desc limit ${limit}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    expenseDate: r.expense_date,
    category: r.category,
    description: r.description,
    amount: toNumber(r.amount),
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    docType: r.doc_type,
    docNumber: r.doc_number,
    status: r.status,
    notes: r.notes,
    source: r.source,
    documentId: r.document_id,
    voidReason: r.void_reason,
    actor: r.actor,
    createdAt: r.created_at,
  }));
}

export async function listExpenseCategories(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ category: string }>("select distinct category from expenses order by category");
  const set = new Set([...EXPENSE_CATEGORIES, ...rows.map((r) => r.category)]);
  return [...set];
}
