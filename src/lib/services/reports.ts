import type { Queryable } from "@/lib/db/types";
import { addMonths, startOfMonth, todayAR } from "@/lib/domain/format";
import { toNumber, toNumberOrNull } from "@/lib/domain/numbers";
import type { BaseUnit } from "@/lib/domain/units";
import { listExpiringLots } from "./lots";
import { listMovements } from "./movements";
import { listProducts } from "./products";

export interface MonthPoint {
  month: string;
  purchases: number;
  expenses: number;
}

/** Serie mensual de compras (registradas) y gastos generales, incluyendo meses sin movimiento. */
export async function monthlySpending(q: Queryable, months = 6, today = todayAR()): Promise<MonthPoint[]> {
  const first = startOfMonth(addMonths(today, -(months - 1)));
  const rows = await q.query<{ month: string; purchases: string; expenses: string }>(
    `with months as (
       select to_char(d, 'YYYY-MM') as month
       from generate_series($1::date, date_trunc('month', $2::date)::date, interval '1 month') d
     )
     select m.month,
       coalesce((select sum(total) from purchases where status = 'registrada' and to_char(purchase_date, 'YYYY-MM') = m.month), 0) as purchases,
       coalesce((select sum(amount) from expenses where status = 'registrado' and to_char(expense_date, 'YYYY-MM') = m.month), 0) as expenses
     from months m order by m.month`,
    [first, today],
  );
  return rows.map((r) => ({ month: r.month, purchases: toNumber(r.purchases), expenses: toNumber(r.expenses) }));
}

export interface SpendingTotals {
  purchases: number;
  expenses: number;
  total: number;
  pendingPurchases: number;
}

export async function spendingTotals(q: Queryable, from: string, to: string): Promise<SpendingTotals> {
  const [row] = await q.query<{ purchases: string; expenses: string; pending: number }>(
    `select
       coalesce((select sum(total) from purchases where status = 'registrada' and purchase_date between $1::date and $2::date), 0) as purchases,
       coalesce((select sum(amount) from expenses where status = 'registrado' and expense_date between $1::date and $2::date), 0) as expenses,
       (select count(*)::int from purchases where status = 'pendiente_precio' and purchase_date between $1::date and $2::date) as pending`,
    [from, to],
  );
  const purchases = toNumber(row.purchases);
  const expenses = toNumber(row.expenses);
  return { purchases, expenses, total: Math.round((purchases + expenses) * 100) / 100, pendingPurchases: row.pending };
}

export interface ConsumptionRow {
  productId: string;
  productName: string;
  category: string | null;
  baseUnit: BaseUnit;
  quantity: number;
  estimatedCost: number | null;
  movements: number;
}

/** Consumos netos por producto (descontando consumos revertidos), con costo estimado. */
export async function consumptionByProduct(
  q: Queryable,
  filters: { from: string; to: string; category?: string | null; productId?: string | null },
): Promise<ConsumptionRow[]> {
  const params: unknown[] = [filters.from, filters.to];
  const extra: string[] = [];
  if (filters.category) {
    params.push(filters.category);
    extra.push(`p.category = $${params.length}`);
  }
  if (filters.productId) {
    params.push(filters.productId);
    extra.push(`p.id = $${params.length}::uuid`);
  }
  const rows = await q.query<{
    product_id: string;
    product_name: string;
    category: string | null;
    base_unit: BaseUnit;
    quantity: string;
    cost: string | null;
    has_cost: boolean;
    movements: number;
  }>(
    `select p.id as product_id, p.name as product_name, p.category, p.base_unit,
       sum(-m.quantity) as quantity,
       sum(-m.quantity * coalesce(m.unit_cost, p.unit_cost)) as cost,
       bool_and(coalesce(m.unit_cost, p.unit_cost) is not null) as has_cost,
       count(*) filter (where m.kind = 'consumo')::int as movements
     from stock_movements m
     join products p on p.id = m.product_id
     left join stock_movements o on o.id = m.reverses_movement_id
     where m.effective_date between $1::date and $2::date
       and (m.kind = 'consumo' or (m.kind = 'reversion' and o.kind = 'consumo'))
       ${extra.length ? `and ${extra.join(" and ")}` : ""}
     group by p.id, p.name, p.category, p.base_unit
     having sum(-m.quantity) > 0
     order by cost desc nulls last, quantity desc`,
    params,
  );
  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    category: r.category,
    baseUnit: r.base_unit,
    quantity: toNumber(r.quantity),
    estimatedCost: r.has_cost ? Math.round(toNumber(r.cost) * 100) / 100 : null,
    movements: r.movements,
  }));
}

export interface SpendingEntry {
  type: "compra" | "gasto";
  id: string;
  number: number;
  date: string;
  description: string;
  category: string;
  supplierName: string | null;
  amount: number | null;
  status: string;
}

export async function spendingEntries(q: Queryable, filters: { from: string; to: string; category?: string | null }): Promise<SpendingEntry[]> {
  const rows = await q.query<{
    type: "compra" | "gasto";
    id: string;
    number: number;
    date: string;
    description: string;
    category: string;
    supplier_name: string | null;
    amount: string | null;
    status: string;
  }>(
    `select * from (
       select 'compra' as type, pu.id, pu.number, pu.purchase_date as date,
         coalesce((select string_agg(coalesce(p.name, i.description), ', ' order by i.position)
                   from purchase_items i left join products p on p.id = i.product_id where i.purchase_id = pu.id), 'Compra') as description,
         'Materiales e insumos' as category, s.name as supplier_name, pu.total as amount, pu.status
       from purchases pu left join suppliers s on s.id = pu.supplier_id
       where pu.purchase_date between $1::date and $2::date and pu.status <> 'anulada'
       union all
       select 'gasto' as type, e.id, e.number, e.expense_date as date, e.description, e.category, s.name as supplier_name,
         e.amount, e.status
       from expenses e left join suppliers s on s.id = e.supplier_id
       where e.expense_date between $1::date and $2::date and e.status <> 'anulado'
     ) t
     ${filters.category ? "where t.category = $3" : ""}
     order by t.date desc, t.number desc`,
    filters.category ? [filters.from, filters.to, filters.category] : [filters.from, filters.to],
  );
  return rows.map((r) => ({
    type: r.type,
    id: r.id,
    number: r.number,
    date: r.date,
    description: r.description,
    category: r.category,
    supplierName: r.supplier_name,
    amount: toNumberOrNull(r.amount),
    status: r.status,
  }));
}

export async function spendingByCategory(q: Queryable, from: string, to: string): Promise<{ category: string; amount: number }[]> {
  const entries = await spendingEntries(q, { from, to });
  const map = new Map<string, number>();
  for (const e of entries) if (e.amount !== null) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
  return [...map.entries()].map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
}

export async function getSetting<T>(q: Queryable, key: string): Promise<T | null> {
  const [row] = await q.query<{ value: T }>("select value from app_settings where key = $1", [key]);
  return row?.value ?? null;
}

export async function setSetting(q: Queryable, key: string, value: unknown): Promise<void> {
  await q.query(
    `insert into app_settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function dashboardSummary(q: Queryable, today = todayAR()) {
  const monthFrom = startOfMonth(today);
  const prevFrom = startOfMonth(addMonths(today, -1));
  const prevTo = new Date(new Date(`${monthFrom}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const [products, month, prevMonth, series, consumption, recent, expiring, lastBackup] = await Promise.all([
    listProducts(q),
    spendingTotals(q, monthFrom, today),
    spendingTotals(q, prevFrom, prevTo),
    monthlySpending(q, 6, today),
    consumptionByProduct(q, { from: monthFrom, to: today }),
    listMovements(q, { limit: 8 }),
    listExpiringLots(q, 60, today),
    getSetting<{ at: string }>(q, "ultimo_respaldo"),
  ]);
  const inventoryValue = Math.round(products.reduce((acc, p) => acc + (p.stockValue ?? 0), 0) * 100) / 100;
  const alerts = products
    .filter((p) => p.status !== "ok")
    .sort((a, b) => (a.status === b.status ? a.currentStock / (a.minStock || 1) - b.currentStock / (b.minStock || 1) : a.status === "agotado" ? -1 : 1));
  return {
    today,
    products: {
      active: products.length,
      bajo: products.filter((p) => p.status === "bajo").length,
      agotado: products.filter((p) => p.status === "agotado").length,
      withoutCost: products.filter((p) => p.unitCost === null && p.currentStock > 0).length,
      inventoryValue,
    },
    month,
    prevMonth,
    series,
    consumption: {
      rows: consumption.slice(0, 6),
      products: consumption.length,
      estimatedCost: Math.round(consumption.reduce((acc, r) => acc + (r.estimatedCost ?? 0), 0) * 100) / 100,
      movements: consumption.reduce((acc, r) => acc + r.movements, 0),
    },
    alerts: alerts.slice(0, 8),
    alertsTotal: alerts.length,
    expiring,
    recentMovements: recent.movements,
    lastBackupAt: lastBackup?.at ?? null,
  };
}
export type DashboardSummary = Awaited<ReturnType<typeof dashboardSummary>>;
