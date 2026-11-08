"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createPurchaseAction, type PurchaseFormValues } from "@/app/(app)/actions";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { Alert } from "@/components/ui/alert";
import { useConfirmableAction } from "@/components/forms/use-confirmable-action";
import { ProductFormModal } from "@/components/inventory/product-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { formatARS, todayAR } from "@/lib/domain/format";
import { parseDecimalAR } from "@/lib/domain/numbers";
import { normalizeName } from "@/lib/domain/normalize";
import { unitOptionsFor } from "@/lib/domain/unit-options";
import { DOC_TYPE_LABELS, DOC_TYPES } from "@/lib/services/documents-types";
import type { Product, Supplier } from "@/lib/services/types";
import { ProductPicker } from "./product-picker";

export interface PurchaseLine {
  key: number;
  /** undefined = sin elegir; null = línea no inventariable. */
  productId: string | null | undefined;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  lotCode: string;
  expiresOn: string;
}

const emptyLine = (key: number): PurchaseLine => ({
  key,
  productId: undefined,
  description: "",
  quantity: "1",
  unit: "",
  unitPrice: "",
  lineTotal: "",
  lotCode: "",
  expiresOn: "",
});

export function lineAmount(line: PurchaseLine): number | null {
  const total = parseDecimalAR(line.lineTotal);
  if (total !== null) return total;
  const price = parseDecimalAR(line.unitPrice);
  const qty = parseDecimalAR(line.quantity);
  if (price !== null && qty !== null) return Math.round(price * qty * 100) / 100;
  return null;
}

export function PurchaseForm({ products, suppliers, categories }: { products: Product[]; suppliers: Supplier[]; categories: string[] }) {
  const router = useRouter();
  const [supplierName, setSupplierName] = useState("");
  const [date, setDate] = useState(todayAR());
  const [docType, setDocType] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([{ ...emptyLine(1) }]);
  const [taxAmount, setTaxAmount] = useState("");
  const [otherTaxes, setOtherTaxes] = useState("");
  const [total, setTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [creatingFor, setCreatingFor] = useState<{ key: number; name: string } | null>(null);
  const [created, setCreated] = useState<Product[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const catalog = useMemo(() => {
    const ids = new Set(products.map((p) => p.id));
    return [...products, ...created.filter((p) => !ids.has(p.id))];
  }, [products, created]);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  const existingSupplier = suppliers.find((s) => normalizeName(s.name) === normalizeName(supplierName));
  const amounts = lines.map(lineAmount);
  const allPriced = amounts.every((a) => a !== null);
  const sumLines = allPriced ? Math.round(amounts.reduce<number>((acc, a) => acc + (a ?? 0), 0) * 100) / 100 : null;
  const taxes = (parseDecimalAR(taxAmount) ?? 0) + (parseDecimalAR(otherTaxes) ?? 0);
  const computedTotal = sumLines !== null ? Math.round((sumLines + taxes) * 100) / 100 : null;

  const update = (key: number, patch: Partial<PurchaseLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const action = useConfirmableAction(createPurchaseAction, {
    onSuccess: (data) => {
      const d = data as { purchaseId: string; number: number; status: string; duplicate?: boolean };
      toast.success(d.duplicate ? "Esa compra ya estaba registrada." : `Compra #${d.number} registrada${d.status === "pendiente_precio" ? " (precio pendiente)" : ""}.`);
      router.push(`/compras/${d.purchaseId}`);
      router.refresh();
    },
  });

  const submit = () => {
    const unchosen = lines.findIndex((l) => l.productId === undefined);
    if (unchosen >= 0) {
      setLocalError(`Línea ${unchosen + 1}: elegí un producto o «Sin producto» para gastos como envíos.`);
      return;
    }
    setLocalError(null);
    const values: PurchaseFormValues = {
      supplierId: existingSupplier?.id ?? null,
      supplierName: existingSupplier ? null : supplierName || null,
      purchaseDate: date,
      docType: docType || null,
      docNumber: docNumber || null,
      items: lines.map((l) => ({
        productId: l.productId ?? null,
        description: l.description || null,
        quantity: l.quantity,
        unit: l.unit || null,
        unitPrice: l.unitPrice || null,
        lineTotal: l.lineTotal || null,
        lotCode: l.lotCode || null,
        expiresOn: l.expiresOn || null,
      })),
      taxAmount: taxAmount || null,
      otherTaxes: otherTaxes || null,
      total: total || null,
      notes: notes || null,
      source: "manual",
    };
    action.submit(values);
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Card>
        <CardHeader title="Datos del comprobante" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Proveedor"
            htmlFor="c-sup"
            className="sm:col-span-2"
            hint={supplierName && !existingSupplier ? "Proveedor nuevo: se crea al guardar la compra." : undefined}
          >
            <Input id="c-sup" list="proveedores" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Ej.: Dental Sur" />
            <datalist id="proveedores">
              {suppliers.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Fecha" htmlFor="c-date">
            <Input id="c-date" type="date" value={date} max={todayAR()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Comprobante" htmlFor="c-type" optional>
            <Select id="c-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="">Sin especificar</option>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Número de comprobante" htmlFor="c-num" optional hint="Evita cargar dos veces la misma factura.">
            <Input id="c-num" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="0001-00001234" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Productos"
          description="Cada línea con producto suma stock. Las líneas sin producto (envío, servicio) solo suman al total."
          action={
            <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine(Date.now())])}>
              <Plus className="h-4 w-4" /> Línea
            </Button>
          }
        />
        <div className="divide-y divide-line">
          {lines.map((line, idx) => {
            const product = line.productId ? byId.get(line.productId) : undefined;
            const amount = amounts[idx];
            return (
              <div key={line.key} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <Field label={`Línea ${idx + 1}`}>
                    <ProductPicker
                      products={catalog}
                      value={line.productId}
                      onChange={(pid) => update(line.key, { productId: pid, unit: "" })}
                      placeholder="Elegí un producto"
                      onCreateNew={(q) => setCreatingFor({ key: line.key, name: q })}
                    />
                  </Field>
                  {line.productId === null && (
                    <Input
                      className="mt-2"
                      value={line.description}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                      placeholder="Descripción (ej.: envío)"
                      aria-label={`Descripción de la línea ${idx + 1}`}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 lg:col-span-3">
                  <Field label="Cantidad">
                    <NumberInput value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} aria-label={`Cantidad línea ${idx + 1}`} />
                  </Field>
                  <Field label="Unidad">
                    {product ? (
                      <Select value={line.unit} onChange={(e) => update(line.key, { unit: e.target.value })} aria-label={`Unidad línea ${idx + 1}`}>
                        {unitOptionsFor(product.baseUnit, product.presentations).map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input value={line.unit} onChange={(e) => update(line.key, { unit: e.target.value })} placeholder="u" aria-label={`Unidad línea ${idx + 1}`} />
                    )}
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3 lg:col-span-4">
                  <Field label="Precio unitario">
                    <NumberInput value={line.unitPrice} onChange={(e) => update(line.key, { unitPrice: e.target.value })} placeholder="$" aria-label={`Precio unitario línea ${idx + 1}`} />
                  </Field>
                  <Field label="Importe">
                    <NumberInput
                      value={line.lineTotal}
                      onChange={(e) => update(line.key, { lineTotal: e.target.value })}
                      placeholder={amount !== null ? formatARS(amount) : "$"}
                      aria-label={`Importe línea ${idx + 1}`}
                    />
                  </Field>
                </div>
                <div className="flex items-end justify-end lg:col-span-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar línea ${idx + 1}`}
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {product?.tracksExpiry && (
                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 lg:col-span-12 lg:grid-cols-4">
                    <Field label="Lote" optional>
                      <Input value={line.lotCode} onChange={(e) => update(line.key, { lotCode: e.target.value })} aria-label={`Lote línea ${idx + 1}`} />
                    </Field>
                    <Field label="Vencimiento">
                      <Input type="date" value={line.expiresOn} onChange={(e) => update(line.key, { expiresOn: e.target.value })} aria-label={`Vencimiento línea ${idx + 1}`} />
                    </Field>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Importes" description="Si la factura discrimina IVA, cargá los importes netos en las líneas y el IVA acá." />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm font-medium">Suma de líneas</p>
            <p className="tabular mt-2 text-lg font-semibold">{sumLines !== null ? formatARS(sumLines) : <span className="text-base text-muted">Faltan importes</span>}</p>
          </div>
          <Field label="IVA / impuestos" optional>
            <NumberInput value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="$" />
          </Field>
          <Field label="Otros (percepciones)" optional>
            <NumberInput value={otherTaxes} onChange={(e) => setOtherTaxes(e.target.value)} placeholder="$" />
          </Field>
          <Field label="Total pagado" hint={computedTotal !== null && !total ? `Se usará ${formatARS(computedTotal)}` : "Si falta, la compra queda pendiente de precio."}>
            <NumberInput value={total} onChange={(e) => setTotal(e.target.value)} placeholder={computedTotal !== null ? formatARS(computedTotal) : "$"} />
          </Field>
          <Field label="Notas" optional className="sm:col-span-2 lg:col-span-4">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="min-h-16" />
          </Field>
        </CardBody>
      </Card>

      {localError && <Alert tone="error">{localError}</Alert>}
      <ActionFeedback state={action} onConfirm={action.confirm} pending={action.pending} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" size="lg" disabled={action.pending}>
          {action.pending && <Loader2 className="h-5 w-5 animate-spin" />}
          Registrar compra
        </Button>
      </div>

      <ProductFormModal
        open={creatingFor !== null}
        onClose={() => setCreatingFor(null)}
        categories={categories}
        initial={{ name: creatingFor?.name ?? "" }}
        onCreated={(productId, name) => {
          setCreated((c) => [
            ...c,
            {
              id: productId,
              name,
              category: null,
              description: null,
              baseUnit: "unidad",
              currentStock: 0,
              minStock: 0,
              unitCost: null,
              tracksExpiry: false,
              barcode: null,
              archivedAt: null,
              archiveReason: null,
              createdAt: "",
              updatedAt: "",
              status: "agotado",
              stockValue: null,
              presentations: [],
            },
          ]);
          if (creatingFor) update(creatingFor.key, { productId });
          setCreatingFor(null);
          router.refresh();
        }}
      />
    </form>
  );
}
