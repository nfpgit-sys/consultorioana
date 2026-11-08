import type { Metadata } from "next";
import { ExpensesView } from "@/components/expenses/expenses-view";
import { PeriodFilter } from "@/components/period-filter";
import { SystemErrorCard } from "@/components/system-error";
import { PageHeader } from "@/components/ui/card";
import { presetRange, todayAR } from "@/lib/domain/format";
import { loadData } from "@/lib/server/load";
import { listExpenseCategories, listExpenses } from "@/lib/services/expenses";
import { listSuppliers } from "@/lib/services/suppliers";

export const metadata: Metadata = { title: "Gastos" };

export default async function GastosPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; categoria?: string; anulados?: string; nuevo?: string }> }) {
  const p = await searchParams;
  const def = presetRange("mes", todayAR());
  const from = p.desde ?? def.from;
  const to = p.hasta ?? def.to;
  const loaded = await loadData(async (db) => {
    const [expenses, categories, suppliers] = await Promise.all([
      listExpenses(db, { from, to, category: p.categoria ?? null, includeVoided: p.anulados === "1" }),
      listExpenseCategories(db),
      listSuppliers(db),
    ]);
    return { expenses, categories, suppliers };
  });
  return (
    <>
      <PageHeader title="Gastos generales" description="Gastos que no incorporan productos al inventario" />
      {!loaded.ok ? (
        <SystemErrorCard error={loaded.error} />
      ) : (
        <>
          <PeriodFilter
            from={from}
            to={to}
            extra={[
              {
                key: "categoria",
                label: "Categoría",
                value: p.categoria ?? "",
                options: loaded.data.categories.map((c) => ({ value: c, label: c })),
              },
              { key: "anulados", label: "Anulados", value: p.anulados ?? "", options: [{ value: "1", label: "Incluir anulados" }] },
            ]}
          />
          <ExpensesView expenses={loaded.data.expenses} categories={loaded.data.categories} suppliers={loaded.data.suppliers} openNew={p.nuevo === "1"} />
        </>
      )}
    </>
  );
}
