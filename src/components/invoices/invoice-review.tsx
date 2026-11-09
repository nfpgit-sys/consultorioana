"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, PackagePlus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createExpenseAction, createPurchaseAction, discardDocumentAction } from "@/app/(app)/actions";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { useConfirmableAction } from "@/components/forms/use-confirmable-action";
import { ProductFormModal } from "@/components/inventory/product-form";
import { ProductPicker } from "@/components/purchases/product-picker";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Input, NumberInput, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import type { ReviewLine, ReviewModel } from "@/lib/invoices/review";
import { formatARS, todayAR } from "@/lib/domain/format";
import { parseDecimalAR } from "@/lib/domain/numbers";
import { normalizeName } from "@/lib/domain/normalize";
import { unitOptionsFor } from "@/lib/domain/unit-options";
import type { BaseUnit } from "@/lib/domain/units";
import { DOC_TYPE_LABELS, DOC_TYPES } from "@/lib/services/documents-types";
import type { Product, Supplier } from "@/lib/services/types";

interface LineState {
  key: number;
  source: ReviewLine | null;
  description: string;
  productId: string | null | undefined;
  verified: boolean;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  lotCode: string;
  expiresOn: string;
  note: string | null;
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

function initialLines(review: ReviewModel | null): LineState[] {
  if (!review || review.lines.length === 0) {
    return [{ key: 1, source: null, description: "", productId: undefined, verified: true, quantity: "1", unit: "", unitPrice: "", lineTotal: "", lotCode: "", expiresOn: "", note: null }];
  }
  return review.lines.map((l, i) => ({
    key: i + 1,
    source: l,
    description: l.description,
    productId: l.match.status === "sin_coincidencia" ? undefined : l.match.productId,
    verified: l.match.status === "segura",
    quantity: fmt(l.suggested.quantity ?? l.invoiceQuantity),
    unit: l.suggested.unit,
    unitPrice: fmt(l.unitPrice),
    lineTotal: fmt(l.lineTotal),
    lotCode: l.lotCode ?? "",
    expiresOn: l.expiresOn ?? "",
    note: l.suggested.note,
  }));
}

export function InvoiceReview({
  documentId,
  review,
  products,
  suppliers,
  categories,
  expenseCategories,
  canRetry,
  aiEnabled,
  sameFile = [],
}: {
  documentId: string;
  review: ReviewModel | null;
  /** Otros comprobantes con exactamente el mismo archivo (se calcula siempre, con o sin IA). */
  sameFile?: { documentId: string; number: number; status: string }[];
  products: Product[];
  suppliers: Supplier[];
  categories: string[];
  expenseCategories: string[];
  canRetry: boolean;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"compra" | "gasto">(review?.kind ?? "compra");
  const [supplierName, setSupplierName] = useState(review?.supplier.existingName ?? review?.supplier.name ?? "");
  const [supplierCuit, setSupplierCuit] = useState(review?.supplier.cuit ?? "");
  const [date, setDate] = useState(review?.date ?? todayAR());
  const [docType, setDocType] = useState<string>(review?.docType ?? "");
  const [docNumber, setDocNumber] = useState(review?.docNumber ?? "");
  const [lines, setLines] = useState<LineState[]>(() => initialLines(review));
  const includesTax = review?.totals.pricesIncludeTax ?? null;
  const [taxAmount, setTaxAmount] = useState(includesTax === false ? fmt(review?.totals.iva) : "");
  const [otherTaxes, setOtherTaxes] = useState(fmt(review?.totals.otherTaxes));
  const [total, setTotal] = useState(fmt(review?.totals.total));
  const [category, setCategory] = useState(review?.extraction.categoria_gasto_sugerida ?? "");
  const [expenseDescription, setExpenseDescription] = useState(
    review ? [review.extraction.proveedor_nombre, review.lines.map((l) => l.normalizedName ?? l.description).join(", ")].filter(Boolean).join(" · ").slice(0, 300) : "",
  );
  const [creatingFor, setCreatingFor] = useState<LineState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [retrying, startRetry] = useTransition();
  const [discarding, startDiscard] = useTransition();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const existingSupplier = suppliers.find((s) => normalizeName(s.name) === normalizeName(supplierName)) ?? null;

  const update = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onProductChange = (line: LineState, productId: string | null) => {
    const product = productId ? byId.get(productId) : undefined;
    let unit = "";
    let quantity = line.quantity;
    const src = line.source;
    if (product && src?.contentPerUnit) {
      const pres = product.presentations.find((p) => Math.abs(p.factor - src.contentPerUnit!) < 0.0005);
      if (pres) {
        unit = pres.name;
        quantity = fmt(src.invoiceQuantity);
      }
    }
    update(line.key, { productId, unit, quantity, verified: true, note: product || productId === null ? null : line.note });
  };

  const amounts = lines.map((l) => {
    const t = parseDecimalAR(l.lineTotal);
    if (t !== null) return t;
    const p = parseDecimalAR(l.unitPrice);
    const q = parseDecimalAR(l.quantity);
    return p !== null && q !== null ? Math.round(p * q * 100) / 100 : null;
  });
  const sumLines = amounts.every((a) => a !== null) ? Math.round(amounts.reduce<number>((a, b) => a + (b ?? 0), 0) * 100) / 100 : null;
  const computedTotal = sumLines !== null ? Math.round((sumLines + (parseDecimalAR(taxAmount) ?? 0) + (parseDecimalAR(otherTaxes) ?? 0)) * 100) / 100 : null;
  const declaredTotal = parseDecimalAR(total);
  const mismatch = computedTotal !== null && declaredTotal !== null && Math.abs(computedTotal - declaredTotal) > Math.max(1, declaredTotal * 0.01);

  const purchase = useConfirmableAction(createPurchaseAction, {
    onSuccess: (data) => {
      const d = data as { purchaseId: string; number: number };
      toast.success(`Compra #${d.number} registrada desde la factura.`);
      router.push(`/compras/${d.purchaseId}`);
      router.refresh();
    },
  });
  const expense = useConfirmableAction(createExpenseAction, {
    onSuccess: (data) => {
      toast.success(`Gasto #${(data as { number: number }).number} registrado desde la factura.`);
      router.push("/gastos");
      router.refresh();
    },
  });

  const submit = () => {
    setLocalError(null);
    if (review?.duplicate) {
      setLocalError(`Este comprobante ya está registrado (${review.duplicate.kind} #${review.duplicate.number}).`);
      return;
    }
    if (kind === "gasto") {
      expense.submit({
        source: "factura",
        documentId,
        expenseDate: date,
        category,
        description: expenseDescription,
        amount: total || (computedTotal !== null ? String(computedTotal) : ""),
        supplierId: existingSupplier?.id ?? null,
        supplierName: existingSupplier ? null : supplierName || null,
        supplierCuit: existingSupplier ? null : supplierCuit || null,
        docType: docType || null,
        docNumber: docNumber || null,
      });
      return;
    }
    const pending = lines.findIndex((l) => l.productId === undefined);
    if (pending >= 0) {
      setLocalError(`Línea ${pending + 1}: elegí el producto, creá uno nuevo o marcala como «no es inventario».`);
      return;
    }
    const unverified = lines.findIndex((l) => !l.verified);
    if (unverified >= 0) {
      setLocalError(`Línea ${unverified + 1}: confirmá que el producto sugerido es correcto o elegí otro.`);
      return;
    }
    purchase.submit({
      source: "factura",
      documentId,
      supplierId: existingSupplier?.id ?? null,
      supplierName: existingSupplier ? null : supplierName || null,
      supplierCuit: existingSupplier ? null : supplierCuit || null,
      purchaseDate: date,
      docType: docType || null,
      docNumber: docNumber || null,
      items: lines.map((l) => ({
        productId: l.productId ?? null,
        description: l.description || null,
        quantity: l.quantity,
        unit: l.productId ? l.unit || null : l.source?.invoiceUnit ?? null,
        unitPrice: l.unitPrice || null,
        lineTotal: l.lineTotal || null,
        lotCode: l.lotCode || null,
        expiresOn: l.expiresOn || null,
        learnAlias: l.productId && l.description ? l.description : null,
      })),
      taxAmount: taxAmount || null,
      otherTaxes: otherTaxes || null,
      total: total || null,
    });
  };

  const active = kind === "compra" ? purchase : expense;
  const repeated = review?.sameFile ?? sameFile;

  return (
    <div className="space-y-5">
      {review?.duplicate && (
        <Alert tone="error" title="Comprobante ya registrado">
          Este proveedor ya tiene registrado el comprobante {review.docNumber} ({review.duplicate.kind} #{review.duplicate.number}). No se puede cargar dos veces.
        </Alert>
      )}
      {repeated.length > 0 && (
        <Alert tone="warning" title="Archivo repetido">
          Este mismo archivo ya se subió antes (comprobante{repeated.length > 1 ? "s" : ""}{" "}
          {repeated.map((s) => `#${s.number}${s.status === "registrado" ? " ya registrado" : ""}`).join(", ")}). Revisá que no sea un duplicado.
        </Alert>
      )}
      {review?.currencyWarning && <Alert tone="warning">{review.currencyWarning}</Alert>}
      {review && review.extraction.legibilidad !== "buena" && (
        <Alert tone="warning" title="Lectura con dudas">
          {review.extraction.observaciones ?? "Parte del comprobante no se leyó con claridad. Revisá cada dato."}
        </Alert>
      )}
      {!review && (
        <Alert
          tone="info"
          title="Carga manual"
          action={
            canRetry && aiEnabled ? (
              <Button
                size="sm"
                variant="outline"
                disabled={retrying}
                onClick={() =>
                  startRetry(async () => {
                    const res = await fetch(`/api/facturas/${documentId}/analizar`, { method: "POST" });
                    const data = (await res.json().catch(() => ({}))) as { error?: string };
                    if (!res.ok) toast.error(data.error ?? "No se pudo leer.");
                    router.refresh();
                  })
                }
              >
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Reintentar lectura automática
              </Button>
            ) : undefined
          }
        >
          No hay datos leídos automáticamente: completá los datos mirando el comprobante.
        </Alert>
      )}

      <Card>
        <CardHeader title="Tipo de registro" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {(["compra", "gasto"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-2xl border px-4 py-3 text-left",
                kind === k ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/20" : "border-line bg-white hover:bg-slate-50",
              )}
            >
              <p className="font-semibold">{k === "compra" ? "Compra de materiales" : "Gasto general"}</p>
              <p className="text-sm text-muted">{k === "compra" ? "Suma los productos al inventario." : "Servicio o gasto sin stock (luz, laboratorio, alquiler…)."}</p>
            </button>
          ))}
          {review && (
            <p className="flex items-center gap-1.5 text-xs text-muted sm:col-span-2">
              <Sparkles className="h-3.5 w-3.5" /> La IA lo clasificó como {review.kind === "compra" ? "compra de materiales" : "gasto general"}.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Comprobante" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Proveedor"
            htmlFor="f-sup"
            hint={
              existingSupplier
                ? `Proveedor existente: ${existingSupplier.name}`
                : supplierName
                  ? "Proveedor nuevo: se crea al confirmar."
                  : undefined
            }
          >
            <Input id="f-sup" list="f-proveedores" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            <datalist id="f-proveedores">
              {suppliers.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </Field>
          <Field label="CUIT" htmlFor="f-cuit" optional error={review && !review.supplier.cuitValid && supplierCuit === review.supplier.cuit ? "El CUIT leído no es válido: revisalo." : undefined}>
            <Input id="f-cuit" value={supplierCuit} onChange={(e) => setSupplierCuit(e.target.value)} disabled={Boolean(existingSupplier)} />
          </Field>
          {review && !existingSupplier && review.supplier.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
              <span className="text-muted">¿Es alguno de estos?</span>
              {review.supplier.suggestions.map((s) => (
                <button key={s.id} type="button" onClick={() => setSupplierName(s.name)} className="rounded-full border border-line px-3 py-1 hover:bg-slate-50">
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <Field label="Fecha" htmlFor="f-date" error={review?.dateWarning}>
            <Input id="f-date" type="date" value={date} max={todayAR()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo" htmlFor="f-type">
              <Select id="f-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="">—</option>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Número" htmlFor="f-num">
              <Input id="f-num" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      {kind === "compra" ? (
        <Card>
          <CardHeader
            title="Productos"
            description="Verificá cada línea. Las marcadas «Revisar» necesitan tu confirmación."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { key: Date.now(), source: null, description: "", productId: undefined, verified: true, quantity: "1", unit: "", unitPrice: "", lineTotal: "", lotCode: "", expiresOn: "", note: null },
                  ])
                }
              >
                + Línea
              </Button>
            }
          />
          <div className="divide-y divide-line">
            {lines.map((line, idx) => {
              const product = line.productId ? byId.get(line.productId) : undefined;
              const src = line.source;
              const status = src?.match.status;
              return (
                <div key={line.key} className="space-y-3 px-4 py-4 sm:px-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted">Línea {idx + 1} · texto de la factura</p>
                      {src ? (
                        <p className="font-mono text-sm break-words">{line.description}</p>
                      ) : (
                        <Input value={line.description} onChange={(e) => update(line.key, { description: e.target.value })} placeholder="Descripción" className="mt-1" />
                      )}
                      {src?.normalizedName && src.normalizedName !== line.description && <p className="text-xs text-muted">Interpretado como: {src.normalizedName}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {line.productId === null ? (
                        <Badge>No es inventario</Badge>
                      ) : line.verified && line.productId ? (
                        <Badge tone="success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {status === "segura" && line.productId === src?.match.productId ? `Coincide${src?.match.via === "alias" ? " (aprendido)" : ""}` : "Verificada"}
                        </Badge>
                      ) : line.productId ? (
                        <Badge tone="warning">
                          <CircleHelp className="h-3.5 w-3.5" /> Revisar
                        </Badge>
                      ) : (
                        <Badge tone="info">Producto nuevo o sin elegir</Badge>
                      )}
                      {src?.confidence === "baja" && <Badge tone="warning">Lectura dudosa</Badge>}
                      <button
                        type="button"
                        aria-label={`Quitar línea ${idx + 1}`}
                        onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                        className="text-slate-400 hover:text-rose-600"
                        hidden={lines.length === 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {line.productId && !line.verified && src && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      ¿Es «{product?.name ?? src.match.productName}»?
                      <Button size="sm" variant="outline" onClick={() => update(line.key, { verified: true })}>
                        Sí, es ese
                      </Button>
                      {src.match.alternatives.slice(0, 3).map((a) => (
                        <Button key={a.id} size="sm" variant="ghost" onClick={() => onProductChange(line, a.id)}>
                          Es «{a.name}»
                        </Button>
                      ))}
                    </div>
                  )}

                  <div className="grid gap-3 lg:grid-cols-12">
                    <div className="lg:col-span-4">
                      <ProductPicker
                        products={products}
                        value={line.productId}
                        onChange={(pid) => onProductChange(line, pid)}
                        placeholder="Elegí el producto"
                        noneLabel="No es inventario (envío, servicio…)"
                        onCreateNew={() => setCreatingFor(line)}
                        invalid={line.productId === undefined || (Boolean(line.productId) && !line.verified)}
                      />
                      {line.productId === undefined && src && (
                        <button
                          type="button"
                          onClick={() => setCreatingFor(line)}
                          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
                        >
                          <PackagePlus className="h-4 w-4" /> Crear «{src.newProduct.name}»
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:col-span-4">
                      <NumberInput value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} aria-label={`Cantidad línea ${idx + 1}`} />
                      {product ? (
                        <Select value={line.unit} onChange={(e) => update(line.key, { unit: e.target.value, note: null })} aria-label={`Unidad línea ${idx + 1}`}>
                          {unitOptionsFor(product.baseUnit as BaseUnit, product.presentations).map((u) => (
                            <option key={u.value} value={u.value}>
                              {u.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input value={src?.invoiceUnit ?? ""} disabled aria-label={`Unidad línea ${idx + 1}`} />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:col-span-4">
                      <NumberInput value={line.unitPrice} onChange={(e) => update(line.key, { unitPrice: e.target.value })} placeholder="Precio unit." aria-label={`Precio unitario línea ${idx + 1}`} />
                      <NumberInput value={line.lineTotal} onChange={(e) => update(line.key, { lineTotal: e.target.value })} placeholder="Importe" aria-label={`Importe línea ${idx + 1}`} />
                    </div>
                  </div>
                  {line.note && (
                    <p className="flex gap-1.5 text-sm text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {line.note}
                    </p>
                  )}
                  {product?.tracksExpiry && (
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={line.lotCode} onChange={(e) => update(line.key, { lotCode: e.target.value })} placeholder="Lote" aria-label={`Lote línea ${idx + 1}`} />
                      <Input type="date" value={line.expiresOn} onChange={(e) => update(line.key, { expiresOn: e.target.value })} aria-label={`Vencimiento línea ${idx + 1}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Gasto general" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoría" htmlFor="f-cat">
              <Input id="f-cat" list="f-cats" value={category} onChange={(e) => setCategory(e.target.value)} />
              <datalist id="f-cats">
                {expenseCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Descripción" htmlFor="f-desc">
              <Input id="f-desc" value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)} maxLength={300} />
            </Field>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Importes" description={includesTax === false ? "La factura discrimina IVA: las líneas están sin IVA." : includesTax ? "Los importes de las líneas incluyen IVA." : undefined} />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kind === "compra" && (
            <>
              <div>
                <p className="text-sm font-medium">Suma de líneas</p>
                <p className="tabular mt-2 text-lg font-semibold">{sumLines !== null ? formatARS(sumLines) : <span className="text-base text-muted">Faltan importes</span>}</p>
              </div>
              <Field label="IVA (si está discriminado)" optional>
                <NumberInput value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
              </Field>
              <Field label="Percepciones / otros" optional>
                <NumberInput value={otherTaxes} onChange={(e) => setOtherTaxes(e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Total del comprobante" error={mismatch ? `No coincide con la suma calculada (${formatARS(computedTotal)}). Revisá líneas e impuestos.` : undefined}>
            <NumberInput value={total} onChange={(e) => setTotal(e.target.value)} placeholder={computedTotal !== null ? formatARS(computedTotal) : ""} />
          </Field>
        </CardBody>
      </Card>

      {localError && <Alert tone="error">{localError}</Alert>}
      <ActionFeedback state={active} onConfirm={active.confirm} pending={active.pending} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          variant="ghost"
          className="text-slate-600"
          disabled={discarding}
          onClick={() =>
            startDiscard(async () => {
              const reason = window.prompt("¿Por qué descartás este comprobante? (no se registra nada)", "Cargado por error");
              if (reason === null) return;
              const res = await discardDocumentAction(documentId, reason);
              if (res.ok) {
                toast.success("Comprobante descartado.");
                router.push("/facturas");
                router.refresh();
              } else toast.error(res.error);
            })
          }
        >
          <Trash2 className="h-4 w-4" /> Descartar comprobante
        </Button>
        <Button size="lg" onClick={submit} disabled={active.pending || Boolean(review?.duplicate)}>
          {active.pending && <Loader2 className="h-5 w-5 animate-spin" />}
          {kind === "compra" ? "Confirmar y registrar compra" : "Confirmar y registrar gasto"}
        </Button>
      </div>

      <ProductFormModal
        open={creatingFor !== null}
        onClose={() => setCreatingFor(null)}
        categories={categories}
        initial={
          creatingFor?.source
            ? {
                name: creatingFor.source.newProduct.name,
                baseUnit: creatingFor.source.newProduct.baseUnit,
                presentations: creatingFor.source.newProduct.presentations.map((p) => ({ name: p.name, factor: String(p.factor) })),
                source: "factura",
              }
            : { name: "" }
        }
        onCreated={(productId) => {
          if (creatingFor) {
            const pres = creatingFor.source?.newProduct.presentations[0];
            update(creatingFor.key, {
              productId,
              verified: true,
              unit: pres ? pres.name : "",
              quantity: fmt(creatingFor.source?.invoiceQuantity ?? parseDecimalAR(creatingFor.quantity)),
              note: null,
            });
          }
          setCreatingFor(null);
          router.refresh();
        }}
      />
    </div>
  );
}
