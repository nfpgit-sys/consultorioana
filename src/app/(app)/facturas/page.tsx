import { FileScan } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceUpload } from "@/components/invoices/invoice-upload";
import { SystemErrorCard } from "@/components/system-error";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { getAiConfig } from "@/lib/config";
import { formatARS, formatDate, formatDateTime } from "@/lib/domain/format";
import { loadData } from "@/lib/server/load";
import { listDocuments } from "@/lib/services/documents";

export const metadata: Metadata = { title: "Facturas" };

const STATUS: Record<string, { label: string; tone: "brand" | "warning" | "success" | "neutral" | "danger" }> = {
  pendiente: { label: "Para cargar", tone: "warning" },
  analizado: { label: "Para revisar", tone: "brand" },
  error: { label: "No se pudo leer", tone: "danger" },
  registrado: { label: "Registrada", tone: "success" },
  descartado: { label: "Descartada", tone: "neutral" },
};

export default async function FacturasPage() {
  const ai = getAiConfig();
  const loaded = await loadData((db) => listDocuments(db, 50));
  return (
    <>
      <PageHeader
        title="Facturas"
        description="Subí una foto o PDF: se leen los datos, se relacionan con tu inventario y confirmás antes de registrar."
      />
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Cargar comprobante" description="Facturas, tickets, recibos o remitos de cualquier proveedor" />
          <CardBody>
            <InvoiceUpload aiEnabled={ai.enabled} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Cómo funciona" />
          <CardBody>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              <li>Se leen proveedor, fecha, número, productos, cantidades, precios y total.</li>
              <li>Cada línea se relaciona con tus productos; las dudosas quedan marcadas para que elijas.</li>
              <li>Si un producto no existe, se propone crearlo (sin duplicar nombres parecidos).</li>
              <li>Revisás y corregís todo en una vista previa.</li>
              <li>Recién al confirmar se registra la compra o el gasto y se actualiza el stock.</li>
            </ol>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader title="Comprobantes recientes" />
        {!loaded.ok ? (
          <div className="p-4">
            <SystemErrorCard error={loaded.error} />
          </div>
        ) : loaded.data.length === 0 ? (
          <EmptyState icon={<FileScan className="h-6 w-6" />} title="Todavía no subiste comprobantes" />
        ) : (
          <ul className="divide-y divide-line">
            {loaded.data.map((d) => (
              <li key={d.id}>
                <Link href={`/facturas/${d.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {d.extraction?.proveedor_nombre ?? `Comprobante #${d.number}`}
                      {d.extraction?.numero ? <span className="font-normal text-muted"> · {d.extraction.numero}</span> : null}
                    </p>
                    <p className="text-sm text-muted">
                      Subido {formatDateTime(d.createdAt)}
                      {d.extraction?.fecha ? ` · fecha ${formatDate(d.extraction.fecha)}` : ""} · {d.files.length} archivo{d.files.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {d.extraction?.total != null && <p className="tabular font-semibold">{formatARS(d.extraction.total)}</p>}
                    <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
