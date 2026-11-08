import type { Metadata } from "next";
import { SystemErrorCard } from "@/components/system-error";
import { InventoryView } from "@/components/inventory/inventory-view";
import { PageHeader } from "@/components/ui/card";
import { loadData } from "@/lib/server/load";
import { listCategories, listProducts, SUGGESTED_CATEGORIES } from "@/lib/services/products";
import type { StockStatus } from "@/lib/services/types";

export const metadata: Metadata = { title: "Inventario" };

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; categoria?: string; estado?: string; archivados?: string; nuevo?: string }>;
}) {
  const params = await searchParams;
  const estado = (["ok", "bajo", "agotado"].includes(params.estado ?? "") ? params.estado : "todos") as StockStatus | "todos";
  const archived = params.archivados === "1";
  const loaded = await loadData(async (db) => {
    const [products, allActive, categories] = await Promise.all([
      listProducts(db, { search: params.q, category: params.categoria, status: estado, onlyArchived: archived }),
      listProducts(db),
      listCategories(db),
    ]);
    return {
      products,
      categories,
      counts: {
        total: allActive.length,
        bajo: allActive.filter((p) => p.status === "bajo").length,
        agotado: allActive.filter((p) => p.status === "agotado").length,
      },
    };
  });

  if (!loaded.ok) {
    return (
      <>
        <PageHeader title="Inventario" />
        <SystemErrorCard error={loaded.error} />
      </>
    );
  }
  const categories = [...new Set([...loaded.data.categories, ...SUGGESTED_CATEGORIES])].sort((a, b) => a.localeCompare(b, "es"));
  return (
    <InventoryView
      products={loaded.data.products}
      categories={categories}
      usedCategories={loaded.data.categories}
      counts={loaded.data.counts}
      filters={{ q: params.q ?? "", categoria: params.categoria ?? "", estado, archived }}
      openNew={params.nuevo === "1"}
    />
  );
}
