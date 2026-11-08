import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/inventory/product-detail";
import { SystemErrorCard } from "@/components/system-error";
import { PageHeader } from "@/components/ui/card";
import { loadData } from "@/lib/server/load";
import { listLots } from "@/lib/services/lots";
import { listMovements } from "@/lib/services/movements";
import { getProduct, listCategories, SUGGESTED_CATEGORIES } from "@/lib/services/products";
import { listPurchases } from "@/lib/services/purchases";

export const metadata: Metadata = { title: "Producto" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadData(async (db) => {
    const product = await getProduct(db, id);
    if (!product) return null;
    const [movements, lots, purchases, categories] = await Promise.all([
      listMovements(db, { productId: id, limit: 100 }),
      listLots(db, id),
      listPurchases(db, { productId: id, limit: 10 }),
      listCategories(db),
    ]);
    return { product, movements, lots, purchases, categories };
  });
  if (!loaded.ok) {
    return (
      <>
        <PageHeader title="Producto" />
        <SystemErrorCard error={loaded.error} />
      </>
    );
  }
  if (!loaded.data) notFound();
  const { product, movements, lots, purchases, categories } = loaded.data;
  return (
    <>
      <Link href="/inventario" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Inventario
      </Link>
      <ProductDetail
        product={product}
        movements={movements.movements}
        totalMovements={movements.total}
        lots={lots}
        purchases={purchases}
        categories={[...new Set([...categories, ...SUGGESTED_CATEGORIES])].sort((a, b) => a.localeCompare(b, "es"))}
      />
    </>
  );
}
