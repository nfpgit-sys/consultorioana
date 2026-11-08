import { AlertTriangle, CalendarClock, FileScan, PackagePlus, ShieldCheck, ShoppingCart, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SpendingChart } from "@/components/charts/spending-chart";
import { AskAssistantButton } from "@/components/assistant/ask-button";
import { MovementList } from "@/components/inventory/movement-list";
import { SystemErrorCard } from "@/components/system-error";
import { Alert } from "@/components/ui/alert";
import { Badge, StockBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { formatARS, formatDate, formatLongDate, formatQuantity } from "@/lib/domain/format";
import { loadData } from "@/lib/server/load";
import { dashboardSummary } from "@/lib/services/reports";

export const metadata: Metadata = { title: "Inicio" };

function deltaText(current: number, previous: number): { text: string; tone: "up" | "down" | "flat" } | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "igual que el mes pasado", tone: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${pct}% vs. todo el mes pasado`, tone: pct > 0 ? "up" : "down" };
}

export default async function HomePage() {
  const loaded = await loadData((db) => dashboardSummary(db));
  if (!loaded.ok) {
    return (
      <>
        <PageHeader title="Inicio" />
        <SystemErrorCard error={loaded.error} />
      </>
    );
  }
  const s = loaded.data;
  const delta = deltaText(s.month.total, s.prevMonth.total);
  const backupDays = s.lastBackupAt ? Math.floor((Date.now() - new Date(s.lastBackupAt).getTime()) / 86_400_000) : null;
  const needsBackup = s.products.active > 0 && (backupDays === null || backupDays >= 7);
  const empty = s.products.active === 0;

  return (
    <>
      <PageHeader
        title="Inicio"
        description={formatLongDate(s.today)}
        actions={
          <>
            <ButtonLink href="/compras/nueva" variant="outline">
              <ShoppingCart className="h-5 w-5" /> Nueva compra
            </ButtonLink>
            <ButtonLink href="/facturas" variant="outline">
              <FileScan className="h-5 w-5" /> Cargar factura
            </ButtonLink>
          </>
        }
      />

      {empty && (
        <Card className="mb-5 overflow-hidden">
          <div className="grid gap-4 bg-gradient-to-br from-brand-50 to-white p-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <h2 className="text-lg font-semibold">Empecemos por el inventario</h2>
              <p className="mt-1 text-sm text-muted">
                Cargá tus productos con el botón «+» o escribile al asistente, por ejemplo: «agregá 20 jeringas al inventario». También podés subir una
                factura y se proponen los productos automáticamente.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/inventario?nuevo=1">
                <PackagePlus className="h-5 w-5" /> Nuevo producto
              </ButtonLink>
              <AskAssistantButton prompt="Agregá 20 jeringas al inventario" label="Probar el asistente" />
            </div>
          </div>
        </Card>
      )}

      {needsBackup && (
        <Alert
          tone="info"
          className="mb-5"
          title={backupDays === null ? "Todavía no descargaste un respaldo" : `Último respaldo hace ${backupDays} días`}
          action={
            <ButtonLink href="/ajustes#respaldo" size="sm" variant="outline">
              <ShieldCheck className="h-4 w-4" /> Descargar respaldo
            </ButtonLink>
          }
        >
          Además de las copias del proveedor de la base, conviene guardar un respaldo propio cada semana.
        </Alert>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Productos activos" value={String(s.products.active)} href="/inventario" />
        <Kpi
          label="Stock bajo o agotado"
          value={String(s.products.bajo + s.products.agotado)}
          detail={`${s.products.agotado} agotado${s.products.agotado === 1 ? "" : "s"} · ${s.products.bajo} bajo${s.products.bajo === 1 ? "" : "s"}`}
          tone={s.products.agotado > 0 ? "danger" : s.products.bajo > 0 ? "warning" : undefined}
          href="/inventario?estado=bajo"
        />
        <Kpi
          label="Gastado este mes"
          value={formatARS(s.month.total, { compact: s.month.total >= 1_000_000 })}
          detail={delta?.text ?? (s.month.pendingPurchases ? `${s.month.pendingPurchases} compra(s) sin precio` : "Compras + gastos generales")}
          href="/reportes"
        />
        <Kpi
          label="Valor del inventario"
          value={formatARS(s.products.inventoryValue, { compact: s.products.inventoryValue >= 1_000_000 })}
          detail={s.products.withoutCost ? `${s.products.withoutCost} producto(s) sin costo` : "Estimado con costo promedio"}
          href="/reportes?vista=inventario"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Evolución de gastos"
            description="Últimos 6 meses · compras registradas y gastos generales"
            action={
              <Link href="/reportes" className="text-sm font-medium text-brand-700 hover:underline">
                Reportes
              </Link>
            }
          />
          <CardBody>
            <SpendingChart data={s.series} />
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">Compras este mes</dt>
                <dd className="tabular font-semibold">{formatARS(s.month.purchases)}</dd>
              </div>
              <div>
                <dt className="text-muted">Gastos generales</dt>
                <dd className="tabular font-semibold">{formatARS(s.month.expenses)}</dd>
              </div>
              <div>
                <dt className="text-muted">Mes anterior (total)</dt>
                <dd className="tabular font-semibold">{formatARS(s.prevMonth.total)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Alertas"
            description={s.alertsTotal + s.expiring.length === 0 ? "Todo en orden" : undefined}
            action={
              s.alertsTotal > s.alerts.length ? (
                <Link href="/inventario?estado=bajo" className="text-sm font-medium text-brand-700 hover:underline">
                  Ver todas
                </Link>
              ) : undefined
            }
          />
          <CardBody className="space-y-2">
            {s.alerts.length === 0 && s.expiring.length === 0 && (
              <p className="text-sm text-muted">No hay productos con stock bajo ni vencimientos próximos.</p>
            )}
            {s.alerts.map((p) => (
              <Link key={p.id} href={`/inventario/${p.id}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted">
                    Quedan {formatQuantity(p.currentStock, p.baseUnit)}
                    {p.minStock > 0 ? ` · mínimo ${formatQuantity(p.minStock, p.baseUnit)}` : ""}
                  </span>
                </span>
                <StockBadge status={p.status} />
              </Link>
            ))}
            {s.expiring.map((l) => (
              <Link key={l.id} href={`/inventario/${l.productId}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{l.productName}</span>
                  <span className="text-xs text-muted">
                    Lote {l.lotCode ?? "s/n"} · {formatQuantity(l.quantity, l.baseUnit)} · {formatDate(l.expiresOn)}
                  </span>
                </span>
                <Badge tone={l.daysLeft <= 30 ? "danger" : "warning"}>
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {l.daysLeft < 0 ? "Vencido" : `${l.daysLeft} d`}
                </Badge>
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Consumos del mes"
            description={
              s.consumption.movements
                ? `${s.consumption.movements} registro(s) · costo estimado ${formatARS(s.consumption.estimatedCost)}`
                : "Sin consumos registrados este mes"
            }
          />
          <CardBody className="space-y-2">
            {s.consumption.rows.length === 0 ? (
              <div className="flex items-start gap-2 text-sm text-muted">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Registrá los consumos con el asistente («hoy gasté 3 jeringas») o desde cada producto.
              </div>
            ) : (
              s.consumption.rows.map((r) => (
                <div key={r.productId} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/inventario/${r.productId}`} className="min-w-0 truncate hover:text-brand-700">
                    {r.productName}
                  </Link>
                  <span className="tabular shrink-0 text-right">
                    {formatQuantity(r.quantity, r.baseUnit)}
                    {r.estimatedCost !== null && <span className="block text-xs text-muted">{formatARS(r.estimatedCost)}</span>}
                  </span>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Movimientos recientes"
            action={
              <Link href="/movimientos" className="text-sm font-medium text-brand-700 hover:underline">
                Ver historial
              </Link>
            }
          />
          <MovementList movements={s.recentMovements} compact />
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:hidden">
        <ButtonLink href="/gastos?nuevo=1" variant="outline">
          <Wallet className="h-5 w-5" /> Gasto
        </ButtonLink>
        <ButtonLink href="/inventario?nuevo=1" variant="outline">
          <PackagePlus className="h-5 w-5" /> Producto
        </ButtonLink>
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone,
  href,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "warning" | "danger";
  href?: string;
}) {
  const inner = (
    <Card className="h-full px-4 py-3.5 transition-colors hover:border-brand-200">
      <p className="text-sm text-muted">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${tone === "danger" ? "text-rose-700" : tone === "warning" ? "text-amber-700" : "text-ink"}`}>
        {value}
      </p>
      {detail && <p className="mt-0.5 truncate text-xs text-muted">{detail}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
