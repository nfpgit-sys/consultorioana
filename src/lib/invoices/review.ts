import type { Queryable } from "@/lib/db/types";
import { isValidIsoDate, todayAR } from "@/lib/domain/format";
import { classifyInvoiceLine, type LineMatchStatus } from "@/lib/domain/matching";
import { normalizeName } from "@/lib/domain/normalize";
import { type BaseUnit, convertPhysical, normalizePresentationName, resolvePhysicalUnit, round3, UNIT_DEFS } from "@/lib/domain/units";
import { loadCatalog } from "@/lib/agent/queries";
import { DOC_TYPES, type DocType } from "@/lib/services/documents-types";
import type { InvoiceDocument } from "@/lib/services/documents";
import { findSameFiles } from "@/lib/services/documents";
import { normalizeDocNumber } from "@/lib/services/purchases";
import { findSupplierExact, isValidCuit, normalizeCuit, suggestSuppliers } from "@/lib/services/suppliers";
import type { InvoiceExtraction, InvoiceLine } from "./schema";

export interface ReviewLine {
  index: number;
  description: string;
  normalizedName: string | null;
  invoiceQuantity: number | null;
  invoiceUnit: string | null;
  contentPerUnit: number | null;
  contentUnit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  lotCode: string | null;
  expiresOn: string | null;
  confidence: "alta" | "media" | "baja";
  match: {
    status: LineMatchStatus;
    productId: string | null;
    productName: string | null;
    via: "nombre" | "alias" | null;
    score: number | null;
    alternatives: { id: string; name: string; score: number }[];
  };
  /** Propuesta inicial de cantidad/unidad para el producto elegido. */
  suggested: { quantity: number | null; unit: string; note: string | null };
  /** Datos para crear el producto si no existe. */
  newProduct: { name: string; baseUnit: BaseUnit; presentations: { name: string; factor: number }[] };
}

export interface ReviewModel {
  extraction: InvoiceExtraction;
  kind: "compra" | "gasto";
  supplier: { name: string | null; cuit: string | null; cuitValid: boolean; existingId: string | null; existingName: string | null; suggestions: { id: string; name: string }[] };
  date: string | null;
  dateWarning: string | null;
  docType: DocType | null;
  docNumber: string | null;
  duplicate: { kind: "compra" | "gasto"; number: number; id: string } | null;
  sameFile: { documentId: string; number: number; status: string }[];
  lines: ReviewLine[];
  totals: { subtotal: number | null; iva: number | null; otherTaxes: number | null; discounts: number | null; total: number | null; pricesIncludeTax: boolean | null };
  sumLines: number | null;
  currencyWarning: string | null;
}

function titleCase(s: string): string {
  const lower = s.toLowerCase().trim();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function suggestUnit(
  line: InvoiceLine,
  product: { baseUnit: BaseUnit; presentations: { name: string; factor: number }[] } | null,
): { quantity: number | null; unit: string; note: string | null } {
  const qty = line.cantidad;
  if (!product) return { quantity: qty, unit: "", note: null };
  const invoiceUnit = line.unidad?.trim() ?? "";
  // 1) Presentación con el mismo contenido declarado ("caja x100" y el producto tiene caja = 100).
  if (line.contenido_por_unidad) {
    const byFactor = product.presentations.find((p) => Math.abs(p.factor - line.contenido_por_unidad!) < 0.0005);
    if (byFactor) return { quantity: qty, unit: byFactor.name, note: null };
  }
  // 2) Presentación con el mismo nombre.
  if (invoiceUnit) {
    const byName = product.presentations.find((p) => normalizePresentationName(p.name) === normalizePresentationName(invoiceUnit));
    if (byName) {
      const differs = line.contenido_por_unidad && Math.abs(byName.factor - line.contenido_por_unidad) > 0.0005;
      return {
        quantity: qty,
        unit: byName.name,
        note: differs ? `La factura dice ${line.contenido_por_unidad} por ${invoiceUnit}, pero el producto tiene definida ${byName.name} = ${byName.factor}. Revisá.` : null,
      };
    }
    // 3) Unidad física compatible (g, kg, ml...).
    const physical = resolvePhysicalUnit(invoiceUnit);
    if (physical && UNIT_DEFS[physical].dimension === UNIT_DEFS[product.baseUnit].dimension) {
      return { quantity: qty, unit: physical === product.baseUnit ? "" : physical, note: null };
    }
  }
  // 4) La factura declara el contenido en una unidad compatible: se convierte mostrando la cuenta.
  if (qty !== null && line.contenido_por_unidad && line.unidad_contenido) {
    const contentUnit = resolvePhysicalUnit(line.unidad_contenido);
    if (contentUnit && UNIT_DEFS[contentUnit].dimension === UNIT_DEFS[product.baseUnit].dimension) {
      const perUnit = convertPhysical(line.contenido_por_unidad, contentUnit, product.baseUnit);
      if (perUnit !== null) {
        const total = round3(qty * perUnit);
        return {
          quantity: total,
          unit: "",
          note: `Según la factura: ${qty} ${invoiceUnit || "u."} × ${line.contenido_por_unidad} ${line.unidad_contenido} = ${total} ${UNIT_DEFS[product.baseUnit].plural}. Podés definir la presentación «${invoiceUnit || "caja"}» en el producto para próximas veces.`,
        };
      }
    }
  }
  if (invoiceUnit && !["u", "un", "unid", "unidad", "unidades", "uni", "ud", "uds"].includes(invoiceUnit.toLowerCase().replace(/\./g, ""))) {
    return { quantity: qty, unit: "", note: `La factura usa «${invoiceUnit}» y el producto no tiene esa presentación definida: revisá la cantidad o definí la equivalencia.` };
  }
  return { quantity: qty, unit: "", note: null };
}

function newProductSuggestion(line: InvoiceLine): ReviewLine["newProduct"] {
  const name = titleCase(line.nombre_normalizado || line.descripcion).slice(0, 200);
  const contentUnit = line.unidad_contenido ? resolvePhysicalUnit(line.unidad_contenido) : null;
  const saleUnit = line.unidad ? resolvePhysicalUnit(line.unidad) : null;
  const baseUnit: BaseUnit = contentUnit ?? saleUnit ?? "unidad";
  const presentations: { name: string; factor: number }[] = [];
  const unitWord = line.unidad?.trim().toLowerCase();
  if (line.contenido_por_unidad && unitWord && !resolvePhysicalUnit(unitWord) && !["u", "un", "unidad", "unidades", "unid"].includes(unitWord)) {
    presentations.push({ name: unitWord, factor: line.contenido_por_unidad });
  }
  return { name, baseUnit, presentations };
}

export async function buildReview(q: Queryable, doc: InvoiceDocument): Promise<ReviewModel | null> {
  const ex = doc.extraction;
  if (!ex) return null;
  const catalog = await loadCatalog(q);
  const supplierName = ex.proveedor_nombre?.trim() || null;
  const cuit = normalizeCuit(ex.proveedor_cuit);
  const existing = await findSupplierExact(q, supplierName, cuit);
  const suggestions = !existing && supplierName ? (await suggestSuppliers(q, supplierName)).map((s) => ({ id: s.candidate.id, name: s.candidate.name })) : [];

  // Alias aprendidos de este proveedor primero.
  const supplierAliases = existing
    ? await q.query<{ product_id: string; alias_normalized: string }>("select product_id, alias_normalized from product_aliases where supplier_id = $1", [existing.id])
    : [];
  const candidates = catalog.map((p) => ({
    ...p,
    aliases: [...p.aliases, ...supplierAliases.filter((a) => a.product_id === p.id).map((a) => a.alias_normalized)],
  }));

  const lines: ReviewLine[] = ex.lineas.map((line, index) => {
    const m = classifyInvoiceLine([line.descripcion, line.nombre_normalizado ?? ""], candidates);
    const best = m.status === "sin_coincidencia" ? null : m.best ?? null;
    const product = best ? catalog.find((p) => p.id === best.candidate.id) ?? null : null;
    return {
      index,
      description: line.descripcion,
      normalizedName: line.nombre_normalizado,
      invoiceQuantity: line.cantidad,
      invoiceUnit: line.unidad,
      contentPerUnit: line.contenido_por_unidad,
      contentUnit: line.unidad_contenido,
      unitPrice: line.precio_unitario,
      lineTotal: line.importe,
      lotCode: line.lote,
      expiresOn: line.vencimiento && isValidIsoDate(line.vencimiento) ? line.vencimiento : null,
      confidence: line.confianza,
      match: {
        status: m.status,
        productId: best?.candidate.id ?? null,
        productName: best?.candidate.name ?? null,
        via: best?.via ?? null,
        score: best ? Math.round(best.score * 100) / 100 : null,
        alternatives: m.alternatives.map((a) => ({ id: a.candidate.id, name: a.candidate.name, score: Math.round(a.score * 100) / 100 })),
      },
      suggested: suggestUnit(line, product),
      newProduct: newProductSuggestion(line),
    };
  });

  const docType = (DOC_TYPES as readonly string[]).includes(ex.tipo_documento) ? (ex.tipo_documento as DocType) : null;
  const docNumber = normalizeDocNumber(ex.numero);
  let duplicate: ReviewModel["duplicate"] = null;
  if (existing && docNumber) {
    const [p] = await q.query<{ id: string; number: number }>(
      "select id, number from purchases where supplier_id = $1 and doc_number = $2 and status <> 'anulada' limit 1",
      [existing.id, docNumber],
    );
    if (p) duplicate = { kind: "compra", number: p.number, id: p.id };
    const [e] = await q.query<{ id: string; number: number }>(
      "select id, number from expenses where supplier_id = $1 and doc_number = $2 and status <> 'anulado' limit 1",
      [existing.id, docNumber],
    );
    if (!duplicate && e) duplicate = { kind: "gasto", number: e.number, id: e.id };
  }

  let date = ex.fecha && isValidIsoDate(ex.fecha) ? ex.fecha : null;
  let dateWarning: string | null = null;
  if (ex.fecha && !date) dateWarning = `No se pudo interpretar la fecha «${ex.fecha}». Revisala.`;
  if (date && date > todayAR()) {
    dateWarning = "La fecha leída es posterior a hoy: revisala (puede ser un error de lectura).";
    date = null;
  }
  const amounts = ex.lineas.map((l) => l.importe ?? (l.precio_unitario !== null && l.cantidad !== null ? l.precio_unitario * l.cantidad : null));
  const sumLines = amounts.every((a) => a !== null) && amounts.length ? Math.round(amounts.reduce<number>((a, b) => a + (b ?? 0), 0) * 100) / 100 : null;

  return {
    extraction: ex,
    kind: ex.es_compra_de_insumos ? "compra" : "gasto",
    supplier: {
      name: supplierName,
      cuit,
      cuitValid: cuit ? isValidCuit(cuit) : true,
      existingId: existing?.id ?? null,
      existingName: existing?.name ?? null,
      suggestions,
    },
    date,
    dateWarning,
    docType,
    docNumber,
    duplicate,
    sameFile: await findSameFiles(q, doc.id),
    lines,
    totals: {
      subtotal: ex.subtotal,
      iva: ex.iva,
      otherTaxes: ex.otros_impuestos,
      discounts: ex.descuentos,
      total: ex.total,
      pricesIncludeTax: ex.precios_incluyen_iva,
    },
    sumLines,
    currencyWarning: ex.moneda && !/^(ars|\$|pesos?)$/i.test(ex.moneda.trim()) ? `El comprobante parece estar en ${ex.moneda}. La aplicación registra importes en pesos (ARS): convertilos antes de confirmar.` : null,
  };
}

export function aliasKey(text: string): string {
  return normalizeName(text);
}
