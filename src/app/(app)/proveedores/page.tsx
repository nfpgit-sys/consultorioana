import type { Metadata } from "next";
import { SuppliersView } from "@/components/suppliers/suppliers-view";
import { SystemErrorCard } from "@/components/system-error";
import { PageHeader } from "@/components/ui/card";
import { addMonths, todayAR } from "@/lib/domain/format";
import { toNumber } from "@/lib/domain/numbers";
import { loadData } from "@/lib/server/load";
import { listSuppliers } from "@/lib/services/suppliers";

export const metadata: Metadata = { title: "Proveedores" };

export default async function ProveedoresPage() {
  const loaded = await loadData(async (db) => {
    const suppliers = await listSuppliers(db);
    const rows = await db.query<{ supplier_id: string; total: string }>(
      `select supplier_id, sum(total) as total from purchases
       where status = 'registrada' and supplier_id is not null and purchase_date >= $1::date
       group by supplier_id`,
      [addMonths(todayAR(), -12)],
    );
    return { suppliers, totals: Object.fromEntries(rows.map((r) => [r.supplier_id, toNumber(r.total)])) };
  });
  return (
    <>
      <PageHeader title="Proveedores" description="Se crean automáticamente al registrar compras o facturas" />
      {loaded.ok ? <SuppliersView suppliers={loaded.data.suppliers} totals={loaded.data.totals} /> : <SystemErrorCard error={loaded.error} />}
    </>
  );
}
