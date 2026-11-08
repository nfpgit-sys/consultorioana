import "server-only";
import writeXlsxFile, { type Cell, type SheetData } from "write-excel-file/node";
import type { Queryable } from "@/lib/db/types";
import { formatDateTime, todayAR } from "@/lib/domain/format";
import { unitLabel } from "@/lib/domain/units";
import { SOURCE_LABELS } from "./context";
import { DOC_TYPE_LABELS } from "./documents-types";
import { listExpenses } from "./expenses";
import { listMovements } from "./movements";
import { listProducts } from "./products";
import { getPurchase, listPurchases } from "./purchases";
import { consumptionByProduct } from "./reports";
import { MOVEMENT_KIND_LABELS } from "./types";

const MONEY = "#,##0.00";
const QTY = "#,##0.###";
const DATE = "dd/mm/yyyy";

type ColumnDef = { header: string; width: number };

function header(cols: ColumnDef[]): Cell[] {
  return cols.map((c) => ({ value: c.header, fontWeight: "bold", backgroundColor: "#E8F5F3" }));
}

const date = (d: string | null): Cell => (d ? { value: new Date(`${d}T00:00:00Z`), type: Date, format: DATE } : null);
const money = (n: number | null): Cell => (n === null ? null : { value: n, type: Number, format: MONEY });
const qty = (n: number | null): Cell => (n === null ? null : { value: n, type: Number, format: QTY });
const text = (s: string | null | undefined): Cell => (s ? { value: s, type: String } : null);

export interface ExportFilters {
  from?: string | null;
  to?: string | null;
  productId?: string | null;
  category?: string | null;
}

interface SheetSpec {
  sheet: string;
  data: SheetData;
  columns: { width: number }[];
}

function sheet(name: string, cols: ColumnDef[], rows: Cell[][]): SheetSpec {
  return { sheet: name, data: [header(cols), ...rows], columns: cols.map((c) => ({ width: c.width })) };
}

async function inventorySheet(q: Queryable, filters: ExportFilters): Promise<SheetSpec> {
  const products = await listProducts(q, { category: filters.category });
  const cols: ColumnDef[] = [
    { header: "Producto", width: 36 },
    { header: "Categoría", width: 18 },
    { header: "Stock", width: 12 },
    { header: "Unidad", width: 12 },
    { header: "Stock mínimo", width: 13 },
    { header: "Estado", width: 12 },
    { header: "Costo unitario", width: 15 },
    { header: "Valor del stock", width: 16 },
    { header: "Presentaciones", width: 30 },
    { header: "Controla vencimiento", width: 12 },
  ];
  const rows = products.map((p) => [
    text(p.name),
    text(p.category),
    qty(p.currentStock),
    text(unitLabel(p.baseUnit, 2)),
    qty(p.minStock),
    text(p.status === "ok" ? "Suficiente" : p.status === "bajo" ? "Stock bajo" : "Agotado"),
    money(p.unitCost),
    money(p.stockValue),
    text(p.presentations.map((x) => `1 ${x.name} = ${x.factor}`).join("; ")),
    text(p.tracksExpiry ? "Sí" : "No"),
  ]);
  return sheet("Inventario", cols, rows);
}

async function movementsSheet(q: Queryable, filters: ExportFilters): Promise<SheetSpec> {
  const { movements } = await listMovements(q, {
    from: filters.from,
    to: filters.to,
    productId: filters.productId,
    category: filters.category,
    limit: 500,
  });
  // listMovements limita a 500 por página: se pagina hasta traer todo.
  let all = movements;
  let offset = movements.length;
  while (all.length % 500 === 0 && all.length > 0) {
    const more = await listMovements(q, { from: filters.from, to: filters.to, productId: filters.productId, category: filters.category, limit: 500, offset });
    if (more.movements.length === 0) break;
    all = all.concat(more.movements);
    offset += more.movements.length;
  }
  const cols: ColumnDef[] = [
    { header: "N°", width: 8 },
    { header: "Fecha del hecho", width: 14 },
    { header: "Registrado (hora AR)", width: 18 },
    { header: "Producto", width: 34 },
    { header: "Tipo", width: 16 },
    { header: "Cantidad", width: 12 },
    { header: "Unidad", width: 11 },
    { header: "Stock anterior", width: 13 },
    { header: "Stock posterior", width: 14 },
    { header: "Lote", width: 12 },
    { header: "Motivo", width: 36 },
    { header: "Origen", width: 16 },
    { header: "Quién", width: 14 },
    { header: "Compra N°", width: 10 },
    { header: "Revierte N°", width: 11 },
    { header: "Revertido por N°", width: 14 },
  ];
  const rows = all.map((m) => [
    { value: m.number, type: Number } as Cell,
    date(m.effectiveDate),
    text(formatDateTime(m.createdAt)),
    text(m.productName),
    text(MOVEMENT_KIND_LABELS[m.kind]),
    qty(m.quantity),
    text(unitLabel(m.baseUnit, 2)),
    qty(m.stockBefore),
    qty(m.stockAfter),
    text(m.lotCode),
    text(m.reason),
    text(SOURCE_LABELS[m.source as keyof typeof SOURCE_LABELS] ?? m.source),
    text(m.actor),
    m.purchaseNumber ? ({ value: m.purchaseNumber, type: Number } as Cell) : null,
    m.reversesNumber ? ({ value: m.reversesNumber, type: Number } as Cell) : null,
    m.reversedByNumber ? ({ value: m.reversedByNumber, type: Number } as Cell) : null,
  ]);
  return sheet("Movimientos", cols, rows);
}

async function purchasesSheet(q: Queryable, filters: ExportFilters): Promise<SheetSpec> {
  const list = await listPurchases(q, { from: filters.from, to: filters.to, productId: filters.productId, limit: 1000 });
  const cols: ColumnDef[] = [
    { header: "Compra N°", width: 10 },
    { header: "Fecha", width: 12 },
    { header: "Proveedor", width: 26 },
    { header: "Comprobante", width: 22 },
    { header: "Estado", width: 14 },
    { header: "Producto / descripción", width: 36 },
    { header: "Cantidad", width: 10 },
    { header: "Unidad", width: 12 },
    { header: "Precio unitario", width: 14 },
    { header: "Importe línea", width: 14 },
    { header: "Total compra", width: 14 },
  ];
  const rows: Cell[][] = [];
  for (const summary of list) {
    const p = await getPurchase(q, summary.id);
    if (!p) continue;
    const status = p.status === "registrada" ? "Registrada" : p.status === "anulada" ? "Anulada" : "Falta precio";
    const doc = [p.docType ? DOC_TYPE_LABELS[p.docType] : null, p.docNumber].filter(Boolean).join(" ");
    p.items.forEach((i, idx) => {
      rows.push([
        { value: p.number, type: Number },
        date(p.purchaseDate),
        text(p.supplierName),
        text(doc),
        text(status),
        text(i.productName ?? i.description),
        qty(i.quantity),
        text(i.unit),
        money(i.unitPrice),
        money(i.lineTotal),
        idx === 0 ? money(p.total) : null,
      ]);
    });
  }
  return sheet("Compras", cols, rows);
}

async function expensesSheet(q: Queryable, filters: ExportFilters): Promise<SheetSpec> {
  const list = await listExpenses(q, { from: filters.from, to: filters.to, category: filters.category, includeVoided: true, limit: 2000 });
  const cols: ColumnDef[] = [
    { header: "Gasto N°", width: 9 },
    { header: "Fecha", width: 12 },
    { header: "Categoría", width: 22 },
    { header: "Descripción", width: 40 },
    { header: "Proveedor", width: 24 },
    { header: "Comprobante", width: 22 },
    { header: "Importe", width: 14 },
    { header: "Estado", width: 12 },
  ];
  const rows = list.map((e) => [
    { value: e.number, type: Number } as Cell,
    date(e.expenseDate),
    text(e.category),
    text(e.description),
    text(e.supplierName),
    text([e.docType ? DOC_TYPE_LABELS[e.docType] : null, e.docNumber].filter(Boolean).join(" ")),
    money(e.amount),
    text(e.status === "anulado" ? "Anulado" : "Registrado"),
  ]);
  return sheet("Gastos", cols, rows);
}

async function consumptionSheet(q: Queryable, filters: ExportFilters): Promise<SheetSpec> {
  const rows = await consumptionByProduct(q, {
    from: filters.from ?? "2000-01-01",
    to: filters.to ?? todayAR(),
    category: filters.category,
    productId: filters.productId,
  });
  const cols: ColumnDef[] = [
    { header: "Producto", width: 36 },
    { header: "Categoría", width: 18 },
    { header: "Cantidad consumida", width: 16 },
    { header: "Unidad", width: 12 },
    { header: "Registros", width: 10 },
    { header: "Costo estimado", width: 16 },
  ];
  return sheet(
    "Consumos",
    cols,
    rows.map((r) => [text(r.productName), text(r.category), qty(r.quantity), text(unitLabel(r.baseUnit, 2)), { value: r.movements, type: Number }, money(r.estimatedCost)]),
  );
}

export type ExportKind = "inventario" | "movimientos" | "compras" | "gastos" | "consumos" | "todo";

export async function buildWorkbook(q: Queryable, kind: ExportKind, filters: ExportFilters): Promise<Buffer> {
  const sheets: SheetSpec[] = [];
  if (kind === "inventario" || kind === "todo") sheets.push(await inventorySheet(q, filters));
  if (kind === "movimientos" || kind === "todo") sheets.push(await movementsSheet(q, filters));
  if (kind === "compras" || kind === "todo") sheets.push(await purchasesSheet(q, filters));
  if (kind === "gastos" || kind === "todo") sheets.push(await expensesSheet(q, filters));
  if (kind === "consumos" || kind === "todo") sheets.push(await consumptionSheet(q, filters));
  const result = writeXlsxFile(
    sheets.map((s) => ({ data: s.data, sheet: s.sheet, columns: s.columns, stickyRowsCount: 1 })),
    { fontFamily: "Calibri", fontSize: 11 },
  );
  return (await result.toBuffer()) as Buffer;
}
