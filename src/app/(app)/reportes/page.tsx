import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PeriodFilter } from "@/components/period-filter";
import { SystemErrorCard } from "@/components/system-error";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { formatARS, formatDate, formatQuantity, presetRange, todayAR } from "@/lib/domain/format";
import { loadData } from "@/lib/server/load";
import { listCategories, listProducts } from "@/lib/services/products";
import { consumptionByProduct, spendingByCategory, spendingEntries, spendingTotals } from "@/lib/services/reports";

export const metadata: Metadata = { title: "Reportes" };

type Vista = "gastos" | "consumos" | "inventario";

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; desde?: string; hasta?: string; categoria?: string; producto?: string }>;
}) {
  const p = await searchParams;
  const vista: Vista = p.vista === "consumos" || p.vista === "inventario" ? p.vista : "gastos";
  const def = presetRange("mes", todayAR());
  const from = p.desde ?? def.from;
  const to = p.hasta ?? def.to;

  const loaded = await loadData(async (db) => {
    const categories = await listCategories(db);
    if (vista === "gastos") {
      const [totals, byCategory, entries] = await Promise.all([
        spendingTotals(db, from, to),
        spendingByCategory(db, from, to),
        spendingEntries(db, { from, to, category: p.categoria ?? null }),
      ]);
      return { vista, categories, totals, byCategory, entries } as const;
    }
    if (vista === "consumos") {
      const [rows, products] = await Promise.all([
        consumptionByProduct(db, { from, to, category: p.categoria ?? null, productId: p.producto ?? null }),
        listProducts(db, { includeArchived: true }),
      ]);
      return { vista, categories, rows, products: products.map((x) => ({ value: x.id, label: x.name })) } as const;
    }
    const products = await listProducts(db, { category: p.categoria ?? null });
    return { vista, categories, products } as const;
  });

  const tabs: { value: Vista; label: string }[] = [
    { value: "gastos", label: "Gastos" },
    { value: "consumos", label: "Consumos" },
    { value: "inventario", label: "Inventario" },
  ];
  const exportKind = vista === "gastos" ? "todo" : vista;
  const exportQs = new URLSearchParams({ tipo: exportKind });
  if (vista !== "inventario") {
    exportQs.set("desde", from);
    exportQs.set("hasta", to);
  }
  if (p.categoria) exportQs.set("categoria", p.categoria);
  if (p.producto) exportQs.set("producto", p.producto);

  return (
    <>
      <PageHeader
        title="Reportes"
        actions={
          <a href={`/api/exportar?${exportQs}`} className={buttonClass("outline")}>
            <Download className="h-5 w-5" /> Exportar Excel
          </a>
        }
      />
      <div className="mb-4 inline-flex rounded-2xl border border-line bg-white p-1" role="tablist">
        {tabs.map((t) => (
          <Link
            key={t.value}
            href={`/reportes?vista=${t.value}${vista !== "inventario" && t.value !== "inventario" ? `&desde=${from}&hasta=${to}` : ""}`}
            role="tab"
            aria-selected={vista === t.value}
            className={cn("rounded-xl px-4 py-2 text-sm font-medium", vista === t.value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50")}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {!loaded.ok ? (
        <SystemErrorCard error={loaded.error} />
      ) : loaded.data.vista === "gastos" ? (
        <>
          <PeriodFilter
            from={from}
            to={to}
            extra={[
              {
                key: "categoria",
                label: "Categoría",
                value: p.categoria ?? "",
                options: ["Materiales e insumos", ...loaded.data.byCategory.map((c) => c.category).filter((c) => c !== "Materiales e insumos")].map((c) => ({ value: c, label: c })),
              },
            ]}
          />
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Total del período" value={formatARS(loaded.data.totals.total)} strong />
            <Tile label="Compras de materiales" value={formatARS(loaded.data.totals.purchases)} />
            <Tile label="Gastos generales" value={formatARS(loaded.data.totals.expenses)} />
            <Tile label="Compras sin precio" value={String(loaded.data.totals.pendingPurchases)} detail="No suman al total hasta completarlas" />
          </div>
          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader title="Por categoría" description={`${formatDate(from)} al ${formatDate(to)}`} />
              <CardBody className="space-y-3">
                {loaded.data.byCategory.length === 0 && <p className="text-sm text-muted">Sin gastos en el período.</p>}
                <CategoryBars items={loaded.data.byCategory} />
              </CardBody>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader title="Detalle" description={`${loaded.data.entries.length} registros`} />
              <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
                {loaded.data.entries.map((e) => (
                  <li key={`${e.type}-${e.id}`}>
                    <Link href={e.type === "compra" ? `/compras/${e.id}` : `/gastos?desde=${e.date}&hasta=${e.date}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.description}</p>
                        <p className="truncate text-xs text-muted">
                          {formatDate(e.date)} · {e.category}
                          {e.supplierName ? ` · ${e.supplierName}` : ""}
                        </p>
                      </div>
                      <span className="tabular shrink-0 text-sm font-medium">
                        {e.amount !== null ? formatARS(e.amount) : <Badge tone="warning">Sin precio</Badge>}
                      </span>
                    </Link>
                  </li>
                ))}
                {loaded.data.entries.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Sin registros en el período.</li>}
              </ul>
            </Card>
          </div>
        </>
      ) : loaded.data.vista === "consumos" ? (
        <>
          <PeriodFilter
            from={from}
            to={to}
            extra={[
              { key: "categoria", label: "Categoría", value: p.categoria ?? "", options: loaded.data.categories.map((c) => ({ value: c, label: c })) },
              { key: "producto", label: "Producto", value: p.producto ?? "", options: loaded.data.products },
            ]}
          />
          <Card>
            <CardHeader
              title="Consumos por producto"
              description={`Costo estimado total: ${formatARS(loaded.data.rows.reduce((a, r) => a + (r.estimatedCost ?? 0), 0))} · consumos netos de reversiones`}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted uppercase">
                    <th className="px-4 py-2.5 sm:px-5">Producto</th>
                    <th className="px-3 py-2.5 text-right">Consumido</th>
                    <th className="px-3 py-2.5 text-right">Registros</th>
                    <th className="px-4 py-2.5 text-right sm:px-5">Costo estimado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {loaded.data.rows.map((r) => (
                    <tr key={r.productId}>
                      <td className="px-4 py-2.5 sm:px-5">
                        <Link href={`/inventario/${r.productId}`} className="font-medium hover:text-brand-700">
                          {r.productName}
                        </Link>
                        {r.category && <p className="text-xs text-muted">{r.category}</p>}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{formatQuantity(r.quantity, r.baseUnit)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{r.movements}</td>
                      <td className="tabular px-4 py-2.5 text-right sm:px-5">{r.estimatedCost !== null ? formatARS(r.estimatedCost) : "Sin costo"}</td>
                    </tr>
                  ))}
                  {loaded.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-muted">
                        Sin consumos en el período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <InventoryValuation products={loaded.data.products} categories={loaded.data.categories} category={p.categoria ?? ""} />
      )}
    </>
  );
}

function Tile({ label, value, detail, strong }: { label: string; value: string; detail?: string; strong?: boolean }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("tabular mt-1 font-semibold", strong ? "text-2xl" : "text-xl")}>{value}</p>
      {detail && <p className="text-xs text-muted">{detail}</p>}
    </Card>
  );
}

function InventoryValuation({
  products,
  categories,
  category,
}: {
  products: Awaited<ReturnType<typeof listProducts>>;
  categories: string[];
  category: string;
}) {
  const total = products.reduce((a, p) => a + (p.stockValue ?? 0), 0);
  const groups = new Map<string, number>();
  for (const p of products) groups.set(p.category ?? "Sin categoría", (groups.get(p.category ?? "Sin categoría") ?? 0) + (p.stockValue ?? 0));
  const withoutCost = products.filter((p) => p.unitCost === null && p.currentStock > 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Link href="/reportes?vista=inventario" className={cn("rounded-full border px-3.5 py-1.5 text-sm", !category ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white")}>
          Todas
        </Link>
        {categories.map((c) => (
          <Link
            key={c}
            href={`/reportes?vista=inventario&categoria=${encodeURIComponent(c)}`}
            className={cn("rounded-full border px-3.5 py-1.5 text-sm", category === c ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white")}
          >
            {c}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Valor estimado" value={formatARS(total)} strong />
        <Tile label="Productos" value={String(products.length)} />
        <Tile label="Sin costo cargado" value={String(withoutCost.length)} detail="Con stock pero sin costo: no suman al valor" />
        <Tile label="Categorías" value={String(groups.size)} />
      </div>
      <Card>
        <CardHeader title="Valor por categoría" />
        <CardBody className="space-y-1.5 text-sm">
          {[...groups.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([c, v]) => (
              <div key={c} className="flex justify-between">
                <span>{c}</span>
                <span className="tabular font-medium">{formatARS(v)}</span>
              </div>
            ))}
        </CardBody>
      </Card>
    </div>
  );
}

function CategoryBars({ items }: { items: { category: string; amount: number }[] }) {
  const max = items[0]?.amount || 1;
  return (
    <>
      {items.map((c) => (
        <div key={c.category} title={`${c.category}: ${formatARS(c.amount)}`}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate">{c.category}</span>
            <span className="tabular shrink-0 font-medium">{formatARS(c.amount)}</span>
          </div>
          <div className="h-2.5 rounded-r-[4px] bg-slate-100">
            <div className="h-2.5 rounded-r-[4px] bg-[#0d9488]" style={{ width: `${Math.max((c.amount / max) * 100, 1)}%` }} />
          </div>
        </div>
      ))}
    </>
  );
}
