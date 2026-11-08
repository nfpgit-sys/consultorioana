import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PurchaseForm } from "@/components/purchases/purchase-form";
import { SystemErrorCard } from "@/components/system-error";
import { PageHeader } from "@/components/ui/card";
import { loadData } from "@/lib/server/load";
import { listCategories, listProducts, SUGGESTED_CATEGORIES } from "@/lib/services/products";
import { listSuppliers } from "@/lib/services/suppliers";

export const metadata: Metadata = { title: "Nueva compra" };

export default async function NuevaCompraPage() {
  const loaded = await loadData(async (db) => {
    const [products, suppliers, categories] = await Promise.all([listProducts(db), listSuppliers(db), listCategories(db)]);
    return { products, suppliers, categories };
  });
  return (
    <>
      <Link href="/compras" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Compras
      </Link>
      <PageHeader title="Nueva compra" description="Registra la compra, suma el stock y actualiza el costo de cada producto." />
      {loaded.ok ? (
        <PurchaseForm
          products={loaded.data.products}
          suppliers={loaded.data.suppliers}
          categories={[...new Set([...loaded.data.categories, ...SUGGESTED_CATEGORIES])].sort((a, b) => a.localeCompare(b, "es"))}
        />
      ) : (
        <SystemErrorCard error={loaded.error} />
      )}
    </>
  );
}
