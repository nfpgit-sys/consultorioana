import type { Queryable } from "@/lib/db/types";
import { formatQuantity } from "@/lib/domain/format";
import { rankCandidates, resolveProductQuery } from "@/lib/domain/matching";
import { normalizeName } from "@/lib/domain/normalize";
import { listExpiringLots } from "@/lib/services/lots";
import { listMovements } from "@/lib/services/movements";
import { listProducts } from "@/lib/services/products";
import { consumptionByProduct, spendingByCategory, spendingTotals } from "@/lib/services/reports";
import { listSuppliers } from "@/lib/services/suppliers";
import type { Product } from "@/lib/services/types";
import { MOVEMENT_KIND_LABELS } from "@/lib/services/types";

export interface CatalogProduct extends Product {
  aliases: string[];
}

/** Catálogo activo con alias aprendidos (para identificar productos). */
export async function loadCatalog(q: Queryable): Promise<CatalogProduct[]> {
  const [products, aliases] = await Promise.all([
    listProducts(q),
    q.query<{ product_id: string; alias_normalized: string }>("select product_id, alias_normalized from product_aliases"),
  ]);
  const byProduct = new Map<string, string[]>();
  for (const a of aliases) byProduct.set(a.product_id, [...(byProduct.get(a.product_id) ?? []), a.alias_normalized]);
  return products.map((p) => ({ ...p, aliases: byProduct.get(p.id) ?? [] }));
}

export function productSummary(p: Product) {
  return {
    producto_id: p.id,
    nombre: p.name,
    categoria: p.category,
    unidad_base: p.baseUnit,
    stock: p.currentStock,
    stock_texto: formatQuantity(p.currentStock, p.baseUnit),
    stock_minimo: p.minStock,
    estado: p.status,
    costo_unitario: p.unitCost,
    presentaciones: p.presentations.map((x) => ({ nombre: x.name, equivale: x.factor })),
    controla_vencimiento: p.tracksExpiry,
  };
}

export function searchCatalog(catalog: CatalogProduct[], text: string, limit = 8) {
  const resolution = resolveProductQuery(text, catalog);
  const ranked = rankCandidates(text, catalog, "consulta", limit).filter((r) => r.score >= 0.35);
  return {
    resolucion: resolution.status,
    coincidencias: ranked.map((r) => ({ ...productSummary(r.candidate), similitud: Math.round(r.score * 100) / 100 })),
  };
}

export async function lowStock(q: Queryable) {
  const products = await listProducts(q);
  return products
    .filter((p) => p.status !== "ok")
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, "es") : a.status === "agotado" ? -1 : 1))
    .map(productSummary);
}

export async function spendingSummary(q: Queryable, from: string, to: string) {
  const [totals, byCategory] = await Promise.all([spendingTotals(q, from, to), spendingByCategory(q, from, to)]);
  return {
    desde: from,
    hasta: to,
    total: totals.total,
    compras_de_materiales: totals.purchases,
    gastos_generales: totals.expenses,
    compras_sin_precio: totals.pendingPurchases,
    por_categoria: byCategory.map((c) => ({ categoria: c.category, importe: c.amount })),
  };
}

export async function consumptionSummary(q: Queryable, from: string, to: string, productId?: string | null) {
  const rows = await consumptionByProduct(q, { from, to, productId });
  return rows.map((r) => ({
    producto_id: r.productId,
    nombre: r.productName,
    consumido: r.quantity,
    consumido_texto: formatQuantity(r.quantity, r.baseUnit),
    costo_estimado: r.estimatedCost,
    registros: r.movements,
  }));
}

export async function recentMovements(q: Queryable, opts: { productId?: string | null; kind?: string | null; limit?: number }) {
  const { movements } = await listMovements(q, {
    productId: opts.productId ?? null,
    kind: (opts.kind as never) ?? null,
    limit: Math.min(opts.limit ?? 10, 30),
  });
  return movements.map((m) => ({
    movimiento_id: m.id,
    numero: m.number,
    producto: m.productName,
    tipo: MOVEMENT_KIND_LABELS[m.kind],
    cantidad: m.quantity,
    cantidad_texto: formatQuantity(m.quantity, m.baseUnit),
    stock_despues: m.stockAfter,
    fecha: m.effectiveDate,
    registrado: m.createdAt,
    motivo: m.reason,
    origen: m.source,
    revertido: Boolean(m.reversedByNumber),
    es_de_compra: Boolean(m.purchaseId),
  }));
}

export async function expiringSoon(q: Queryable, days: number) {
  const lots = await listExpiringLots(q, days);
  return lots.map((l) => ({
    producto: l.productName,
    lote: l.lotCode,
    vence: l.expiresOn,
    dias_restantes: l.daysLeft,
    cantidad_texto: formatQuantity(l.quantity, l.baseUnit),
  }));
}

export async function supplierSearch(q: Queryable, text?: string | null) {
  const suppliers = await listSuppliers(q);
  const list = text ? rankCandidates(text, suppliers, "consulta", 5).filter((r) => r.score >= 0.5).map((r) => r.candidate) : suppliers.slice(0, 30);
  return list.map((s) => ({ proveedor_id: s.id, nombre: s.name, cuit: s.cuit }));
}

export function sameName(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}
