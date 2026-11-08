import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MovementFilters } from "@/components/inventory/movement-filters";
import { MovementList } from "@/components/inventory/movement-list";
import { SystemErrorCard } from "@/components/system-error";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { loadData } from "@/lib/server/load";
import { listMovements } from "@/lib/services/movements";
import { listCategories, listProducts } from "@/lib/services/products";
import type { MovementKind } from "@/lib/services/types";

export const metadata: Metadata = { title: "Movimientos" };

const PAGE_SIZE = 50;
const KINDS: MovementKind[] = ["stock_inicial", "compra", "ingreso", "consumo", "ajuste", "reversion", "vencimiento"];

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{ producto?: string; tipo?: string; origen?: string; desde?: string; hasta?: string; categoria?: string; pagina?: string }>;
}) {
  const p = await searchParams;
  const page = Math.max(1, Number(p.pagina ?? 1) || 1);
  const kind = KINDS.includes(p.tipo as MovementKind) ? (p.tipo as MovementKind) : null;
  const filters = {
    productId: p.producto ?? null,
    kind,
    source: ["manual", "texto", "voz", "factura"].includes(p.origen ?? "") ? p.origen! : null,
    from: p.desde ?? null,
    to: p.hasta ?? null,
    category: p.categoria ?? null,
  };
  const loaded = await loadData(async (db) => {
    const [result, products, categories] = await Promise.all([
      listMovements(db, { ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      listProducts(db, { includeArchived: true }),
      listCategories(db),
    ]);
    return { ...result, products: products.map((x) => ({ id: x.id, name: x.name, archived: Boolean(x.archivedAt) })), categories };
  });
  if (!loaded.ok) {
    return (
      <>
        <PageHeader title="Movimientos" />
        <SystemErrorCard error={loaded.error} />
      </>
    );
  }
  const { movements, total, products, categories } = loaded.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (overrides: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { ...p, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    return sp.toString();
  };
  const exportQs = new URLSearchParams({ tipo: "movimientos" });
  if (filters.from) exportQs.set("desde", filters.from);
  if (filters.to) exportQs.set("hasta", filters.to);
  if (filters.productId) exportQs.set("producto", filters.productId);
  if (filters.category) exportQs.set("categoria", filters.category);

  return (
    <>
      <PageHeader
        title="Movimientos"
        description="Historial completo e inmutable. Para corregir un error se registra una reversión o un ajuste."
        actions={
          <a href={`/api/exportar?${exportQs}`} className={buttonClass("outline")}>
            <Download className="h-5 w-5" /> Exportar Excel
          </a>
        }
      />
      <MovementFilters products={products} categories={categories} values={p} />
      <Card>
        <div className="border-b border-line px-4 py-3 text-sm text-muted sm:px-5">
          {total} movimiento{total === 1 ? "" : "s"}
          {pages > 1 && ` · página ${page} de ${pages}`}
        </div>
        <MovementList movements={movements} />
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm sm:px-5">
            {page > 1 ? (
              <Link href={`/movimientos?${qs({ pagina: String(page - 1) })}`} className="font-medium text-brand-700">
                ← Anteriores
              </Link>
            ) : (
              <span />
            )}
            {page < pages && (
              <Link href={`/movimientos?${qs({ pagina: String(page + 1) })}`} className="font-medium text-brand-700">
                Siguientes →
              </Link>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
