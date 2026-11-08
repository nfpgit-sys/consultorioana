import { z } from "zod";
import type { Database, Queryable } from "@/lib/db/types";
import { rankCandidates } from "@/lib/domain/matching";
import { cleanDisplayName, normalizeName } from "@/lib/domain/normalize";
import { type ActionContext, audit, withOperation } from "./context";
import { DomainError, NotFoundError, translateDbError } from "./errors";
import type { Supplier } from "./types";
import { optionalText, uuid } from "./validation";

/** Valida el dígito verificador de un CUIT/CUIL argentino (11 dígitos). */
export function isValidCuit(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) check = 9;
  return check === Number(digits[10]);
}

export function normalizeCuit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length ? digits : null;
}

export function formatCuit(cuit: string | null): string {
  if (!cuit || cuit.length !== 11) return cuit ?? "";
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

const cuitField = optionalText(20).refine((v) => !v || isValidCuit(v), {
  message: "CUIT inválido: revisá los 11 dígitos.",
});

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "El nombre del proveedor es obligatorio.").max(200),
  cuit: cuitField,
  phone: optionalText(60),
  email: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "Email inválido." }),
  notes: optionalText(1000),
});

interface SupplierRow {
  id: string;
  name: string;
  cuit: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  archived_at: string | null;
}

const mapSupplier = (r: SupplierRow): Supplier => ({
  id: r.id,
  name: r.name,
  cuit: r.cuit,
  phone: r.phone,
  email: r.email,
  notes: r.notes,
  archivedAt: r.archived_at,
});

export async function listSuppliers(q: Queryable, opts: { includeArchived?: boolean } = {}): Promise<Supplier[]> {
  const rows = await q.query<SupplierRow>(
    `select id, name, cuit, phone, email, notes, archived_at from suppliers
     ${opts.includeArchived ? "" : "where archived_at is null"} order by lower(name)`,
  );
  return rows.map(mapSupplier);
}

export async function getSupplier(q: Queryable, id: string): Promise<Supplier | null> {
  if (!uuid.safeParse(id).success) return null;
  const rows = await q.query<SupplierRow>("select id, name, cuit, phone, email, notes, archived_at from suppliers where id = $1", [id]);
  return rows[0] ? mapSupplier(rows[0]) : null;
}

/** Busca un proveedor por CUIT o por nombre idéntico (normalizado). No usa coincidencias aproximadas. */
export async function findSupplierExact(q: Queryable, name: string | null, cuit: string | null): Promise<Supplier | null> {
  const normalizedCuit = normalizeCuit(cuit);
  if (normalizedCuit) {
    const rows = await q.query<SupplierRow>(
      "select id, name, cuit, phone, email, notes, archived_at from suppliers where cuit = $1 and archived_at is null",
      [normalizedCuit],
    );
    if (rows[0]) return mapSupplier(rows[0]);
  }
  if (name && normalizeName(name)) {
    const rows = await q.query<SupplierRow>(
      "select id, name, cuit, phone, email, notes, archived_at from suppliers where normalized_name = $1 and archived_at is null",
      [normalizeName(name)],
    );
    if (rows[0]) return mapSupplier(rows[0]);
  }
  return null;
}

/** Proveedores con nombre parecido (para sugerir en la revisión de facturas). */
export async function suggestSuppliers(q: Queryable, name: string) {
  const all = await listSuppliers(q);
  return rankCandidates(name, all, "factura", 3).filter((r) => r.score >= 0.6);
}

async function insertSupplier(tx: Queryable, ctx: ActionContext, operationId: string, input: z.output<typeof supplierSchema>) {
  const name = cleanDisplayName(input.name);
  const [row] = await tx.query<{ id: string }>(
    `insert into suppliers (name, normalized_name, cuit, phone, email, notes) values ($1, $2, $3, $4, $5, $6) returning id`,
    [name, normalizeName(name), normalizeCuit(input.cuit), input.phone ?? null, input.email ?? null, input.notes ?? null],
  );
  await audit(tx, ctx, { entityType: "proveedor", entityId: row.id, action: "crear", details: { ...input, name }, operationId });
  return row.id;
}

/**
 * Devuelve el id del proveedor indicado: por id, por CUIT o nombre exacto; si no existe y se dio un nombre,
 * lo crea. Debe usarse dentro de una operación (transacción).
 */
export async function resolveOrCreateSupplier(
  tx: Queryable,
  ctx: ActionContext,
  operationId: string,
  input: { supplierId?: string | null; supplierName?: string | null; supplierCuit?: string | null },
): Promise<string | null> {
  if (input.supplierId) {
    const s = await getSupplier(tx, input.supplierId);
    if (!s || s.archivedAt) throw new NotFoundError("El proveedor");
    return s.id;
  }
  const name = input.supplierName?.trim();
  const cuit = normalizeCuit(input.supplierCuit);
  if (!name && !cuit) return null;
  const existing = await findSupplierExact(tx, name ?? null, cuit);
  if (existing) return existing.id;
  if (!name) throw new DomainError("proveedor_requerido", "Indicá el nombre del proveedor.");
  if (cuit && !isValidCuit(cuit)) throw new DomainError("cuit_invalido", "El CUIT del proveedor no es válido.");
  return insertSupplier(tx, ctx, operationId, { name, cuit, phone: null, email: null, notes: null });
}

export async function createSupplier(db: Database, raw: z.input<typeof supplierSchema>, ctx: ActionContext) {
  const input = supplierSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const existing = await findSupplierExact(tx, input.name, input.cuit ?? null);
      if (existing) {
        throw new DomainError("proveedor_duplicado", `Ya existe el proveedor "${existing.name}".`, {
          status: 409,
          details: { supplierId: existing.id },
        });
      }
      return withOperation(tx, ctx, { kind: "crear_proveedor", summary: `Alta de proveedor: ${input.name}` }, async (operationId) => ({
        supplierId: await insertSupplier(tx, ctx, operationId, input),
      }));
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export async function updateSupplier(db: Database, id: string, raw: z.input<typeof supplierSchema>, ctx: ActionContext) {
  const input = supplierSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const current = await getSupplier(tx, id);
      if (!current || current.archivedAt) throw new NotFoundError("El proveedor");
      const name = cleanDisplayName(input.name);
      await tx.query(
        `update suppliers set name = $2, normalized_name = $3, cuit = $4, phone = $5, email = $6, notes = $7, updated_at = now()
         where id = $1`,
        [id, name, normalizeName(name), normalizeCuit(input.cuit), input.phone ?? null, input.email ?? null, input.notes ?? null],
      );
      await withOperation(tx, ctx, { kind: "editar_proveedor" }, async (operationId) => {
        await audit(tx, ctx, { entityType: "proveedor", entityId: id, action: "editar", details: { antes: current, despues: input }, operationId });
        return null;
      });
      return { supplierId: id };
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export async function archiveSupplier(db: Database, id: string, ctx: ActionContext) {
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ name: string }>(
      "update suppliers set archived_at = now(), updated_at = now() where id = $1 and archived_at is null returning name",
      [id],
    );
    if (!row) throw new NotFoundError("El proveedor");
    await withOperation(tx, ctx, { kind: "archivar_proveedor" }, async (operationId) => {
      await audit(tx, ctx, { entityType: "proveedor", entityId: id, action: "archivar", details: { nombre: row.name }, operationId });
      return null;
    });
    return { supplierId: id };
  });
}
