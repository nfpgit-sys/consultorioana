import { z } from "zod";
import type { Database, Queryable } from "@/lib/db/types";
import { findNearDuplicates } from "@/lib/domain/matching";
import { cleanDisplayName, normalizeName, normalizeText } from "@/lib/domain/normalize";
import { toDecimalString, toNumber, toNumberOrNull } from "@/lib/domain/numbers";
import { BASE_UNITS, type BaseUnit, normalizePresentationName, resolvePhysicalUnit, round3 } from "@/lib/domain/units";
import { type ActionContext, audit, withOperation } from "./context";
import { DomainError, NotFoundError, translateDbError } from "./errors";
import { applyStockChange } from "./stock";
import type { Presentation, Product, StockStatus } from "./types";
import { isoDate, optionalText, uuid } from "./validation";

export function stockStatus(current: number, min: number): StockStatus {
  if (current <= 0) return "agotado";
  if (min > 0 && current <= min) return "bajo";
  return "ok";
}

interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  base_unit: BaseUnit;
  current_stock: string;
  min_stock: string;
  unit_cost: string | null;
  tracks_expiry: boolean;
  barcode: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

const PRODUCT_COLUMNS = `p.id, p.name, p.category, p.description, p.base_unit, p.current_stock, p.min_stock, p.unit_cost,
  p.tracks_expiry, p.barcode, p.archived_at, p.archive_reason, p.created_at, p.updated_at`;

function mapProduct(row: ProductRow, presentations: Presentation[]): Product {
  const currentStock = toNumber(row.current_stock);
  const minStock = toNumber(row.min_stock);
  const unitCost = toNumberOrNull(row.unit_cost);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    baseUnit: row.base_unit,
    currentStock,
    minStock,
    unitCost,
    tracksExpiry: row.tracks_expiry,
    barcode: row.barcode,
    archivedAt: row.archived_at,
    archiveReason: row.archive_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: stockStatus(currentStock, minStock),
    stockValue: unitCost === null ? null : Math.round(currentStock * unitCost * 100) / 100,
    presentations,
  };
}

async function loadPresentations(q: Queryable, productIds: string[]): Promise<Map<string, Presentation[]>> {
  const map = new Map<string, Presentation[]>();
  if (productIds.length === 0) return map;
  const rows = await q.query<{ id: string; product_id: string; name: string; factor: string }>(
    `select id, product_id, name, factor from product_presentations
     where product_id = any($1::uuid[]) and archived_at is null
     order by factor asc, name asc`,
    [productIds],
  );
  for (const r of rows) {
    const list = map.get(r.product_id) ?? [];
    list.push({ id: r.id, name: r.name, factor: toNumber(r.factor) });
    map.set(r.product_id, list);
  }
  return map;
}

export interface ProductFilters {
  search?: string | null;
  category?: string | null;
  status?: StockStatus | "todos" | null;
  includeArchived?: boolean;
  onlyArchived?: boolean;
}

function matchesSearch(product: Product, search: string): boolean {
  const terms = normalizeText(search).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeText(`${product.name} ${product.category ?? ""} ${product.barcode ?? ""} ${product.description ?? ""}`)
    .split(" ")
    .filter(Boolean);
  return terms.every((term) => haystack.some((word) => word.startsWith(term) || (term.length >= 4 && word.includes(term))));
}

export async function listProducts(q: Queryable, filters: ProductFilters = {}): Promise<Product[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.onlyArchived) where.push("p.archived_at is not null");
  else if (!filters.includeArchived) where.push("p.archived_at is null");
  if (filters.category) {
    params.push(filters.category);
    where.push(`p.category = $${params.length}`);
  }
  const rows = await q.query<ProductRow>(
    `select ${PRODUCT_COLUMNS} from products p ${where.length ? `where ${where.join(" and ")}` : ""}
     order by lower(p.name) asc`,
    params,
  );
  const presentations = await loadPresentations(q, rows.map((r) => r.id));
  let products = rows.map((r) => mapProduct(r, presentations.get(r.id) ?? []));
  if (filters.search?.trim()) products = products.filter((p) => matchesSearch(p, filters.search!));
  if (filters.status && filters.status !== "todos") products = products.filter((p) => p.status === filters.status);
  return products;
}

export async function getProduct(q: Queryable, id: string): Promise<Product | null> {
  if (!uuid.safeParse(id).success) return null;
  const rows = await q.query<ProductRow>(`select ${PRODUCT_COLUMNS} from products p where p.id = $1`, [id]);
  if (rows.length === 0) return null;
  const presentations = await loadPresentations(q, [id]);
  return mapProduct(rows[0], presentations.get(id) ?? []);
}

export async function listCategories(q: Queryable): Promise<string[]> {
  const rows = await q.query<{ category: string }>(
    `select distinct category from products where category is not null and archived_at is null order by category`,
  );
  return rows.map((r) => r.category);
}

/** Categorías sugeridas para un consultorio odontológico (se pueden escribir otras). */
export const SUGGESTED_CATEGORIES = [
  "Descartables",
  "Bioseguridad",
  "Anestesia",
  "Restauración",
  "Endodoncia",
  "Periodoncia",
  "Ortodoncia",
  "Prótesis",
  "Cirugía",
  "Impresión",
  "Higiene y profilaxis",
  "Radiología",
  "Instrumental",
  "Limpieza",
  "Medicamentos",
  "Oficina",
];

const presentationSchema = z.object({
  name: z.string().trim().min(1, "La presentación necesita un nombre.").max(60),
  factor: z.number().finite().positive("La equivalencia tiene que ser mayor que cero.").max(10_000_000),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(200),
  category: optionalText(80),
  description: optionalText(1000),
  baseUnit: z.enum(BASE_UNITS, { message: "Elegí una unidad de medida válida." }),
  minStock: z.number().finite().min(0, "El stock mínimo no puede ser negativo.").max(1_000_000_000).default(0),
  unitCost: z.number().finite().min(0, "El costo no puede ser negativo.").max(10_000_000_000).nullable().optional(),
  tracksExpiry: z.boolean().default(false),
  barcode: optionalText(60),
  initialStock: z.number().finite().min(0, "El stock inicial no puede ser negativo.").max(1_000_000_000).default(0),
  initialLotCode: optionalText(60),
  initialExpiresOn: isoDate.nullable().optional(),
  presentations: z.array(presentationSchema).max(10).default([]),
  /** La persona ya vio la advertencia de producto parecido y confirma que es otro. */
  acknowledgeSimilar: z.boolean().default(false),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

function validatePresentationName(name: string, baseUnit: BaseUnit) {
  const physical = resolvePhysicalUnit(name);
  if (physical) {
    throw new DomainError(
      "presentacion_invalida",
      `"${name}" es una unidad de medida, no una presentación. Las conversiones entre unidades físicas (${baseUnit}) son automáticas.`,
    );
  }
}

async function assertNoDuplicateName(q: Queryable, name: string, excludeId: string | null, acknowledgeSimilar: boolean) {
  const normalized = normalizeName(name);
  if (!normalized) throw new DomainError("nombre_invalido", "El nombre tiene que tener letras o números.");
  const existing = await q.query<{ id: string; name: string; normalized_name: string }>(
    "select id, name, normalized_name from products where archived_at is null and ($1::uuid is null or id <> $1::uuid)",
    [excludeId],
  );
  const exact = existing.find((p) => p.normalized_name === normalized);
  if (exact) {
    throw new DomainError("producto_duplicado", `Ya existe el producto "${exact.name}". Usá ese producto en lugar de crear otro.`, {
      status: 409,
      details: { productId: exact.id },
    });
  }
  if (!acknowledgeSimilar) {
    const similar = findNearDuplicates(name, existing.map((p) => ({ id: p.id, name: p.name })));
    if (similar.length > 0) {
      throw new DomainError(
        "producto_similar",
        `Hay productos con un nombre muy parecido: ${similar.map((s) => `"${s.candidate.name}"`).join(", ")}. ¿Es un producto distinto?`,
        { status: 409, details: { similar: similar.map((s) => ({ id: s.candidate.id, name: s.candidate.name })) } },
      );
    }
  }
}

export async function createProduct(db: Database, rawInput: CreateProductInput, ctx: ActionContext) {
  const input = createProductSchema.parse(rawInput);
  const name = cleanDisplayName(input.name);
  const names = new Set<string>();
  for (const p of input.presentations) {
    validatePresentationName(p.name, input.baseUnit);
    const key = normalizePresentationName(p.name);
    if (names.has(key)) throw new DomainError("presentacion_repetida", `La presentación "${p.name}" está repetida.`);
    names.add(key);
  }
  if (input.initialStock > 0 && round3(input.initialStock) <= 0) {
    throw new DomainError("cantidad_invalida", "El stock inicial es demasiado chico.");
  }
  try {
    return await db.transaction(async (tx) => {
      await assertNoDuplicateName(tx, name, null, input.acknowledgeSimilar);
      return withOperation(tx, ctx, { kind: "crear_producto", summary: `Alta de producto: ${name}` }, async (operationId) => {
        const [row] = await tx.query<{ id: string }>(
          `insert into products (name, normalized_name, category, description, base_unit, min_stock, unit_cost, tracks_expiry, barcode)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [
            name,
            normalizeName(name),
            input.category ? cleanDisplayName(input.category) : null,
            input.description ?? null,
            input.baseUnit,
            toDecimalString(round3(input.minStock)),
            input.unitCost === null || input.unitCost === undefined ? null : toDecimalString(input.unitCost, 4),
            input.tracksExpiry,
            input.barcode ?? null,
          ],
        );
        for (const p of input.presentations) {
          await tx.query(
            `insert into product_presentations (product_id, name, normalized_name, factor) values ($1, $2, $3, $4)`,
            [row.id, cleanDisplayName(p.name), normalizePresentationName(p.name), toDecimalString(round3(p.factor))],
          );
        }
        await audit(tx, ctx, {
          entityType: "producto",
          entityId: row.id,
          action: "crear",
          details: { ...input, name, acknowledgeSimilar: undefined },
          operationId,
        });
        if (input.initialStock > 0) {
          const product = (await lockProductForStock(tx, row.id))!;
          await applyStockChange(tx, ctx, operationId, {
            product,
            delta: round3(input.initialStock),
            kind: "stock_inicial",
            reason: "Stock inicial al dar de alta el producto",
            unitCost: input.unitCost ?? null,
            lot: input.tracksExpiry ? { lotCode: input.initialLotCode ?? null, expiresOn: input.initialExpiresOn ?? null } : null,
          });
        }
        return { productId: row.id, name };
      });
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: optionalText(80),
  description: optionalText(1000),
  baseUnit: z.enum(BASE_UNITS).optional(),
  minStock: z.number().finite().min(0).max(1_000_000_000).optional(),
  unitCost: z.number().finite().min(0).max(10_000_000_000).nullable().optional(),
  tracksExpiry: z.boolean().optional(),
  barcode: optionalText(60),
  acknowledgeSimilar: z.boolean().default(false),
});
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export async function updateProduct(db: Database, id: string, rawInput: UpdateProductInput, ctx: ActionContext) {
  const input = updateProductSchema.parse(rawInput);
  try {
    return await db.transaction(async (tx) => {
      const current = await lockProductForStock(tx, id);
      if (!current || current.archived_at) throw new NotFoundError("El producto");
      const changes: Record<string, { antes: unknown; despues: unknown }> = {};
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (column: string, value: unknown, label: string, before: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
        changes[label] = { antes: before, despues: value };
      };

      if (input.name !== undefined) {
        const name = cleanDisplayName(input.name);
        if (name !== current.name) {
          await assertNoDuplicateName(tx, name, id, input.acknowledgeSimilar);
          set("name", name, "nombre", current.name);
          params.push(normalizeName(name));
          sets.push(`normalized_name = $${params.length}`);
        }
      }
      if (input.category !== undefined) {
        const category = input.category ? cleanDisplayName(input.category) : null;
        if (category !== current.category) set("category", category, "categoria", current.category);
      }
      if (input.description !== undefined && (input.description ?? null) !== current.description) {
        set("description", input.description ?? null, "descripcion", current.description);
      }
      if (input.barcode !== undefined && (input.barcode ?? null) !== current.barcode) {
        set("barcode", input.barcode ?? null, "codigo", current.barcode);
      }
      if (input.minStock !== undefined && round3(input.minStock) !== current.min_stock) {
        set("min_stock", toDecimalString(round3(input.minStock)), "stock_minimo", current.min_stock);
      }
      if (input.unitCost !== undefined && (input.unitCost ?? null) !== current.unit_cost) {
        set("unit_cost", input.unitCost === null ? null : toDecimalString(input.unitCost, 4), "costo_unitario", current.unit_cost);
      }
      if (input.baseUnit !== undefined && input.baseUnit !== current.base_unit) {
        const [{ count }] = await tx.query<{ count: number }>(
          "select count(*)::int as count from stock_movements where product_id = $1",
          [id],
        );
        if (count > 0) {
          throw new DomainError(
            "unidad_bloqueada",
            "No se puede cambiar la unidad base de un producto con movimientos: el historial quedaría inconsistente. Creá un producto nuevo si cambió la forma de medirlo.",
          );
        }
        set("base_unit", input.baseUnit, "unidad_base", current.base_unit);
      }
      if (input.tracksExpiry !== undefined && input.tracksExpiry !== current.tracks_expiry) {
        set("tracks_expiry", input.tracksExpiry, "controla_vencimiento", current.tracks_expiry);
        if (input.tracksExpiry && current.current_stock > 0) {
          // El stock existente queda en un lote "sin datos" hasta que se corrija.
          await tx.query("update lots set quantity = 0, updated_at = now() where product_id = $1", [id]);
          await tx.query(
            `insert into lots (product_id, lot_code, expires_on, quantity) values ($1, null, null, $2)
             on conflict (product_id, (coalesce(lot_code, '')), (coalesce(expires_on, 'infinity'::date)))
             do update set quantity = excluded.quantity, updated_at = now()`,
            [id, toDecimalString(current.current_stock)],
          );
        }
      }
      if (sets.length === 0) return { productId: id, changed: false };
      await tx.query(`update products set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
      await withOperation(tx, ctx, { kind: "editar_producto", summary: `Edición de producto: ${current.name}` }, async (operationId) => {
        await audit(tx, ctx, { entityType: "producto", entityId: id, action: "editar", details: changes, operationId });
        return { productId: id };
      });
      return { productId: id, changed: true };
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export async function archiveProduct(db: Database, id: string, reason: string, ctx: ActionContext) {
  const why = reason.trim();
  if (!why) throw new DomainError("motivo_requerido", "Indicá el motivo para archivar el producto.");
  return db.transaction(async (tx) => {
    const current = await lockProductForStock(tx, id);
    if (!current || current.archived_at) throw new NotFoundError("El producto");
    await tx.query("update products set archived_at = now(), archive_reason = $2, updated_at = now() where id = $1", [id, why]);
    return withOperation(tx, ctx, { kind: "archivar_producto", summary: `Archivo de producto: ${current.name}` }, async (operationId) => {
      await audit(tx, ctx, {
        entityType: "producto",
        entityId: id,
        action: "archivar",
        details: { motivo: why, stock_al_archivar: current.current_stock },
        operationId,
      });
      return { productId: id };
    });
  });
}

export async function unarchiveProduct(db: Database, id: string, ctx: ActionContext) {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.query<{ name: string; archived_at: string | null }>(
        "select name, archived_at from products where id = $1 for update",
        [id],
      );
      if (!row) throw new NotFoundError("El producto");
      if (!row.archived_at) return { productId: id };
      await assertNoDuplicateName(tx, row.name, id, true);
      await tx.query("update products set archived_at = null, archive_reason = null, updated_at = now() where id = $1", [id]);
      return (
        await withOperation(tx, ctx, { kind: "reactivar_producto", summary: `Reactivación: ${row.name}` }, async (operationId) => {
          await audit(tx, ctx, { entityType: "producto", entityId: id, action: "reactivar", operationId });
          return { productId: id };
        })
      ).result;
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export async function addPresentation(db: Database, productId: string, raw: { name: string; factor: number }, ctx: ActionContext) {
  const input = presentationSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const product = await lockProductForStock(tx, productId);
      if (!product || product.archived_at) throw new NotFoundError("El producto");
      validatePresentationName(input.name, product.base_unit);
      const [row] = await tx.query<{ id: string }>(
        `insert into product_presentations (product_id, name, normalized_name, factor) values ($1, $2, $3, $4) returning id`,
        [productId, cleanDisplayName(input.name), normalizePresentationName(input.name), toDecimalString(round3(input.factor))],
      );
      await withOperation(tx, ctx, { kind: "agregar_presentacion", summary: `${product.name}: 1 ${input.name} = ${input.factor}` }, async (operationId) => {
        await audit(tx, ctx, {
          entityType: "producto",
          entityId: productId,
          action: "agregar_presentacion",
          details: { presentacion: input.name, equivalencia: input.factor, unidad_base: product.base_unit },
          operationId,
        });
        return { presentationId: row.id };
      });
      return { presentationId: row.id };
    });
  } catch (err) {
    throw translateDbError(err);
  }
}

export async function archivePresentation(db: Database, presentationId: string, ctx: ActionContext) {
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ product_id: string; name: string }>(
      "update product_presentations set archived_at = now() where id = $1 and archived_at is null returning product_id, name",
      [presentationId],
    );
    if (!row) throw new NotFoundError("La presentación");
    await withOperation(tx, ctx, { kind: "archivar_presentacion" }, async (operationId) => {
      await audit(tx, ctx, {
        entityType: "producto",
        entityId: row.product_id,
        action: "quitar_presentacion",
        details: { presentacion: row.name },
        operationId,
      });
      return null;
    });
    return { productId: row.product_id };
  });
}

export interface LockedProduct {
  id: string;
  name: string;
  base_unit: BaseUnit;
  current_stock: number;
  min_stock: number;
  unit_cost: number | null;
  tracks_expiry: boolean;
  archived_at: string | null;
  category: string | null;
  description: string | null;
  barcode: string | null;
  presentations: Presentation[];
}

/** Bloquea filas de productos (orden por id para evitar interbloqueos) y devuelve su estado. */
export async function lockProductsForStock(tx: Queryable, ids: string[]): Promise<Map<string, LockedProduct>> {
  const valid = [...new Set(ids)].filter((id) => uuid.safeParse(id).success).sort();
  const map = new Map<string, LockedProduct>();
  if (valid.length === 0) return map;
  const rows = await tx.query<{
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
     from products where id = any($1::uuid[]) order by id for update`,
    [valid],
  );
  const presentations = await loadPresentations(tx, rows.map((r) => r.id));
  for (const r of rows) {
    map.set(r.id, {
      ...r,
      current_stock: toNumber(r.current_stock),
      min_stock: toNumber(r.min_stock),
      unit_cost: toNumberOrNull(r.unit_cost),
      presentations: presentations.get(r.id) ?? [],
    });
  }
  return map;
}

export async function lockProductForStock(tx: Queryable, id: string): Promise<LockedProduct | null> {
  return (await lockProductsForStock(tx, [id])).get(id) ?? null;
}
