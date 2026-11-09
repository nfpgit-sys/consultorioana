import { FileScan, Plus, ShoppingCart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PeriodFilter } from "@/components/period-filter";
import { SystemErrorCard } from "@/components/system-error";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { formatARS, formatDate, presetRange, todayAR } from "@/lib/domain/format";
import { loadData } from "@/lib/server/load";
import { DOC_TYPE_LABELS } from "@/lib/services/documents-types";
import { listPurchases } from "@/lib/services/purchases";
import { listSuppliers } from "@/lib/services/suppliers";

export const metadata: Metadata = { title: "Compras" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  registrada: { label: "Registrada", tone: "success" },
  pendiente_precio: { label: "Falta precio", tone: "warning" },
  anulada: { label: "Anulada", tone: "neutral" },
};

export default async function ComprasPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; proveedor?: string; estado?: string }> }) {
  const p = await searchParams;
  const def = presetRange("ultimos_30", todayAR());
  const from = p.desde ?? def.from;
  const to = p.hasta ?? def.to;
  const loaded = await loadData(async (db) => {
    const [purchases, suppliers] = await Promise.all([
      listPurchases(db, { from, to, supplierId: p.proveedor ?? null, status: p.estado ?? null, limit: 500 }),
      listSuppliers(db),
    ]);
    return { purchases, suppliers };
  });

  return (
    <>
      <PageHeader
        title="Compras"
        description="Materiales que se incorporan al inventario"
        actions={
          <>
            <ButtonLink href="/facturas" variant="outline">
              <FileScan className="h-5 w-5" /> Desde factura
            </ButtonLink>
            <ButtonLink href="/compras/nueva">
              <Plus className="h-5 w-5" /> Nueva compra
            </ButtonLink>
          </>
        }
      />
      {!loaded.ok ? (
        <SystemErrorCard error={loaded.error} />
      ) : (
        <>
          <PeriodFilter
            from={from}
            to={to}
            extra={[
              {
                key: "proveedor",
                label: "Proveedor",
                value: p.proveedor ?? "",
                options: loaded.data.suppliers.map((s) => ({ value: s.id, label: s.name })),
              },
              {
                key: "estado",
                label: "Estado",
                value: p.estado ?? "",
                options: [
                  { value: "registrada", label: "Registradas" },
                  { value: "pendiente_precio", label: "Falta precio" },
                  { value: "anulada", label: "Anuladas" },
                ],
              },
            ]}
          />
          <Card>
            {loaded.data.purchases.length === 0 ? (
              <EmptyState
                icon={<ShoppingCart className="h-6 w-6" />}
                title="No hay compras en este período"
                description="Registrá una compra a mano o subí una factura para que se carguen los datos automáticamente."
                action={
                  <ButtonLink href="/compras/nueva">
                    <Plus className="h-5 w-5" /> Nueva compra
                  </ButtonLink>
                }
              />
            ) : (
              <>
                <div className="flex justify-between border-b border-line px-4 py-3 text-sm sm:px-5">
                  <span className="text-muted">{loaded.data.purchases.length} compras</span>
                  <span className="tabular font-semibold">
                    {formatARS(loaded.data.purchases.filter((x) => x.status === "registrada").reduce((a, x) => a + (x.total ?? 0), 0))}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {loaded.data.purchases.map((c) => (
                    <li key={c.id}>
                      <Link href={`/compras/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                        <div className="min-w-0">
                          <p className="flex min-w-0 gap-1.5 font-medium">
                            <span className="truncate">{c.supplierName ?? "Sin proveedor"}</span>
                            <span className="shrink-0 font-normal text-muted">#{c.number}</span>
                          </p>
                          <p className="truncate text-sm text-muted">
                            {formatDate(c.purchaseDate)} · {c.itemCount} línea{c.itemCount === 1 ? "" : "s"}
                            {c.docType ? ` · ${DOC_TYPE_LABELS[c.docType]}` : ""}
                            {c.docNumber ? ` ${c.docNumber}` : ""}
                            {c.source === "factura" ? " · desde factura" : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`tabular font-semibold ${c.status === "anulada" ? "text-slate-400 line-through" : ""}`}>
                            {c.total !== null ? formatARS(c.total) : "—"}
                          </p>
                          {c.status !== "registrada" && <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </>
  );
}
