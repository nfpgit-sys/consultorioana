import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MovementList } from "@/components/inventory/movement-list";
import { PurchaseActions } from "@/components/purchases/purchase-actions";
import { SystemErrorCard } from "@/components/system-error";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { formatARS, formatDate, formatDateTime, formatNumber, formatQuantity } from "@/lib/domain/format";
import { quantityUnitLabel } from "@/lib/domain/units";
import { loadData } from "@/lib/server/load";
import { DOC_TYPE_LABELS } from "@/lib/services/documents-types";
import { listMovements } from "@/lib/services/movements";
import { getPurchase } from "@/lib/services/purchases";

export const metadata: Metadata = { title: "Compra" };

export default async function CompraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadData(async (db) => {
    const purchase = await getPurchase(db, id);
    if (!purchase) return null;
    const movements = await listMovements(db, { purchaseId: id, limit: 200 });
    return { purchase, movements: movements.movements };
  });
  if (!loaded.ok) return <SystemErrorCard error={loaded.error} />;
  if (!loaded.data) notFound();
  const { purchase: c, movements } = loaded.data;

  return (
    <>
      <Link href="/compras" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Compras
      </Link>
      <PageHeader
        title={`Compra #${c.number}`}
        description={`${c.supplierName ?? "Sin proveedor"} · ${formatDate(c.purchaseDate)}${c.docType ? ` · ${DOC_TYPE_LABELS[c.docType]}` : ""}${c.docNumber ? ` ${c.docNumber}` : ""}`}
        actions={<PurchaseActions purchase={c} />}
      />
      {c.status === "anulada" && (
        <Alert tone="info" className="mb-5" title="Compra anulada">
          {c.voidReason} · El stock que había incorporado se revirtió con movimientos de reversión.
        </Alert>
      )}
      {c.status === "pendiente_precio" && (
        <Alert tone="warning" className="mb-5" title="Falta completar precios">
          El stock ya se sumó. Completá los importes para que la compra cuente en los gastos y se actualice el costo de los productos.
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Detalle" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted uppercase">
                  <th className="px-4 py-2.5 sm:px-5">Producto</th>
                  <th className="px-3 py-2.5 text-right">Cantidad</th>
                  <th className="px-3 py-2.5 text-right">P. unit.</th>
                  <th className="px-4 py-2.5 text-right sm:px-5">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {c.items.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2.5 sm:px-5">
                      {i.productId ? (
                        <Link href={`/inventario/${i.productId}`} className="font-medium hover:text-brand-700">
                          {i.productName}
                        </Link>
                      ) : (
                        <span>{i.description}</span>
                      )}
                      {i.productId && i.description !== i.productName && <p className="text-xs text-muted">{i.description}</p>}
                      {(i.lotCode || i.expiresOn) && (
                        <p className="text-xs text-muted">
                          Lote {i.lotCode ?? "s/n"}
                          {i.expiresOn ? ` · vence ${formatDate(i.expiresOn)}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">
                      {formatNumber(i.quantity)} {quantityUnitLabel(i.quantity, i.unit)}
                      {i.baseQuantity !== null && i.baseUnit && i.baseQuantity !== i.quantity && (
                        <p className="text-xs text-muted">= {formatQuantity(i.baseQuantity, i.baseUnit)}</p>
                      )}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{i.unitPrice !== null ? formatARS(i.unitPrice) : "—"}</td>
                    <td className="tabular px-4 py-2.5 text-right font-medium sm:px-5">{i.lineTotal !== null ? formatARS(i.lineTotal) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody className="space-y-1 border-t border-line text-sm">
            {c.subtotal !== null && <Row label="Suma de líneas" value={formatARS(c.subtotal)} />}
            {c.taxAmount !== null && <Row label="IVA / impuestos" value={formatARS(c.taxAmount)} />}
            {c.otherTaxes !== null && <Row label="Otros" value={formatARS(c.otherTaxes)} />}
            <Row label="Total" value={c.total !== null ? formatARS(c.total) : "Pendiente"} strong />
          </CardBody>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Registro" />
            <CardBody className="space-y-1.5 text-sm">
              <Row label="Estado" value={<Badge tone={c.status === "registrada" ? "success" : c.status === "anulada" ? "neutral" : "warning"}>{c.status === "pendiente_precio" ? "Falta precio" : c.status === "anulada" ? "Anulada" : "Registrada"}</Badge>} />
              <Row label="Origen" value={c.source === "factura" ? "Factura" : c.source === "manual" ? "Manual" : "Asistente"} />
              <Row label="Registrada" value={formatDateTime(c.createdAt)} />
              {c.actor && <Row label="Por" value={c.actor} />}
              {c.documentId && (
                <Row
                  label="Comprobante"
                  value={
                    <Link href={`/facturas/${c.documentId}`} className="font-medium text-brand-700 hover:underline">
                      Ver factura
                    </Link>
                  }
                />
              )}
              {c.notes && <p className="pt-2 text-slate-700">{c.notes}</p>}
            </CardBody>
          </Card>
        </div>
        <Card className="lg:col-span-3">
          <CardHeader title="Movimientos de stock generados" />
          <MovementList movements={movements} compact />
        </Card>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`tabular text-right ${strong ? "text-base font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
