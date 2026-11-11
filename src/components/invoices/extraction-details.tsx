import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { formatARS, formatDate } from "@/lib/domain/format";
import type { InvoiceExtraction } from "@/lib/invoices/schema";
import { fieldLabel, formatPeriod, type InvoiceCheck } from "@/lib/invoices/validate";

const KIND_LABELS: Record<InvoiceExtraction["tipo_documento"], string> = {
  factura_a: "Factura A",
  factura_b: "Factura B",
  factura_c: "Factura C",
  factura_m: "Factura M",
  factura_e: "Factura E",
  factura: "Factura (sin letra visible)",
  ticket: "Ticket",
  recibo: "Recibo",
  remito: "Remito",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  liquidacion: "Liquidación",
  presupuesto: "Presupuesto",
  otro: "Otro comprobante",
};

const TAX_LABELS: Record<InvoiceExtraction["impuestos"][number]["tipo"], string> = {
  iva: "IVA",
  percepcion_iva: "Percepción IVA",
  percepcion_iibb: "Percepción IIBB",
  retencion: "Retención",
  impuesto_interno: "Impuesto interno",
  otro: "Otro",
};

/** Resultado de los controles automáticos: qué cierra y qué conviene revisar. */
export function InvoiceChecks({ checks }: { checks: InvoiceCheck[] }) {
  const problems = checks.filter((c) => c.level !== "ok");
  const passed = checks.filter((c) => c.level === "ok");
  return (
    <Card>
      <CardHeader
        title="Controles automáticos"
        description={problems.length ? "Revisá estos puntos antes de confirmar." : "Los datos leídos son coherentes entre sí."}
        action={
          problems.length === 0 ? (
            <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />
          ) : (
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
          )
        }
      />
      <ul className="divide-y divide-line">
        {[...problems.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1)), ...passed].map((c, i) => (
          <li key={i} className="flex gap-2.5 px-4 py-2.5 text-sm sm:px-5">
            {c.level === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Correcto" />
            ) : c.level === "error" ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-label="Error" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label="Revisar" />
            )}
            <span className={cn(c.level === "error" && "text-rose-900", c.level === "aviso" && "text-amber-900")}>{c.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Item({ label, value, doubtful }: { label: string; value: ReactNode; doubtful?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className={cn("min-w-0 rounded-lg px-2 py-1.5", doubtful && "bg-amber-50 ring-1 ring-amber-200")}>
      <dt className="text-xs text-muted">
        {label}
        {doubtful && <span className="ml-1 font-medium text-amber-800">· revisar</span>}
      </dt>
      <dd className="break-words text-sm">{value}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      <dl className="grid gap-x-3 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

const date = (v: string | null) => (v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : v) : null);
const money = (v: number | null) => (v === null ? null : formatARS(v));

/** Todo lo que se leyó del comprobante, con los campos dudosos resaltados. */
export function ExtractionDetails({ extraction: ex, doubtful }: { extraction: InvoiceExtraction; doubtful: string[] }) {
  const set = new Set(doubtful);
  const d = (f: string) => set.has(f) || [...set].some((x) => x.startsWith(`${f}[`) || x.startsWith(`${f}.`));
  const number = [ex.letra && !/^factura_[abcme]$/.test(ex.tipo_documento) ? ex.letra : null, ex.numero].filter(Boolean).join(" ");
  const hasReceiver = ex.receptor_nombre || ex.receptor_documento || ex.receptor_domicilio;

  return (
    <Card>
      <CardHeader title="Datos leídos del comprobante" description="Lo resaltado en amarillo no se leyó con seguridad o no pasó un control." />
      <CardBody className="space-y-4">
        <Group title="Comprobante">
          <Item label="Tipo" value={[KIND_LABELS[ex.tipo_documento], ex.descripcion_comprobante].filter(Boolean).join(" · ")} doubtful={d("tipo_documento")} />
          <Item label="Número" value={number || null} doubtful={d("numero")} />
          <Item label="Emisión" value={date(ex.fecha)} doubtful={d("fecha")} />
          <Item label="Vencimiento" value={date(ex.fecha_vencimiento)} doubtful={d("fecha_vencimiento")} />
          <Item label="Período" value={ex.periodo ? formatPeriod(ex.periodo) : null} doubtful={d("periodo")} />
          <Item label="CAE / CAI" value={ex.cae} doubtful={d("cae")} />
          <Item label="Condición de venta" value={ex.condicion_venta} />
          <Item label="Moneda" value={ex.moneda} doubtful={d("moneda")} />
        </Group>
        <Group title="Emisor (proveedor)">
          <Item label="Nombre o razón social" value={ex.proveedor_nombre ?? "No identificado"} doubtful={d("proveedor_nombre")} />
          <Item label="CUIT" value={ex.proveedor_cuit ?? "No figura"} doubtful={d("proveedor_cuit")} />
          <Item label="Domicilio" value={ex.proveedor_domicilio} doubtful={d("proveedor_domicilio")} />
          <Item label="Condición frente al IVA" value={ex.proveedor_condicion_iva} />
        </Group>
        {hasReceiver && (
          <Group title="Cliente (receptor)">
            <Item label="Nombre" value={ex.receptor_nombre} doubtful={d("receptor_nombre")} />
            <Item label="CUIT / DNI" value={ex.receptor_documento} doubtful={d("receptor_documento")} />
            <Item label="Domicilio" value={ex.receptor_domicilio} doubtful={d("receptor_domicilio")} />
          </Group>
        )}

        {ex.lineas.length > 0 && (
          <div className="space-y-1">
            <h3 className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Conceptos ({ex.lineas.length})</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {ex.lineas.map((l, i) => {
                const lineDoubt = d(`lineas[${i}]`) || l.confianza === "baja";
                const detail = [
                  l.cantidad !== null ? `${String(l.cantidad).replace(".", ",")}${l.unidad ? ` ${l.unidad}` : ""}` : null,
                  l.precio_unitario !== null ? `× ${formatARS(l.precio_unitario)}` : null,
                  l.descuento ? `desc. ${formatARS(l.descuento)}` : null,
                  l.alicuota_iva !== null ? `IVA ${String(l.alicuota_iva).replace(".", ",")}%` : null,
                  l.codigo ? `cód. ${l.codigo}` : null,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={i} className={cn("flex items-start justify-between gap-3 px-3 py-2 text-sm", lineDoubt && "bg-amber-50")}>
                    <div className="min-w-0">
                      <p className="break-words">{l.nombre_normalizado ?? l.descripcion}</p>
                      {(detail || lineDoubt) && (
                        <p className="text-xs text-muted">
                          {detail}
                          {lineDoubt && <span className="font-medium text-amber-800">{detail ? " · " : ""}revisar</span>}
                        </p>
                      )}
                    </div>
                    <p className="tabular shrink-0 font-medium">{l.importe !== null ? formatARS(l.importe) : "—"}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <Group title="Importes">
          <Item label="Subtotal / neto" value={money(ex.subtotal)} doubtful={d("subtotal")} />
          <Item label="Descuentos" value={ex.descuentos ? money(ex.descuentos) : null} doubtful={d("descuentos")} />
          <Item label="IVA" value={money(ex.iva)} doubtful={d("iva")} />
          <Item label="Percepciones / otros impuestos" value={ex.otros_impuestos ? money(ex.otros_impuestos) : null} doubtful={d("otros_impuestos")} />
          <Item label="Retenciones" value={ex.retenciones ? money(ex.retenciones) : null} doubtful={d("retenciones")} />
          <Item label="Total" value={<span className="font-semibold">{money(ex.total) ?? "No encontrado"}</span>} doubtful={d("total")} />
        </Group>

        {ex.impuestos.length > 0 && (
          <div className="space-y-1">
            <h3 className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Detalle de impuestos</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {ex.impuestos.map((t, i) => (
                <li key={i} className={cn("flex justify-between gap-3 px-3 py-2 text-sm", d(`impuestos[${i}]`) && "bg-amber-50")}>
                  <span className="min-w-0 break-words">
                    {t.descripcion ?? TAX_LABELS[t.tipo]}
                    {t.base_imponible !== null && <span className="text-xs text-muted"> · base {formatARS(t.base_imponible)}</span>}
                  </span>
                  <span className="tabular shrink-0">{t.importe !== null ? formatARS(t.importe) : "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {doubtful.length > 0 && (
          <p className="text-sm text-amber-900">
            <span className="font-medium">Para revisar:</span> {[...new Set(doubtful.map(fieldLabel))].join(", ")}.
          </p>
        )}
        {ex.observaciones && <p className="text-sm text-muted">Observaciones de la lectura: {ex.observaciones}</p>}
      </CardBody>
    </Card>
  );
}
