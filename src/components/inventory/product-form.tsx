"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createProductAction, type ProductFormValues, updateProductAction } from "@/app/(app)/actions";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { useConfirmableAction } from "@/components/forms/use-confirmable-action";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/domain/format";
import { BASE_UNIT_OPTIONS } from "@/lib/domain/unit-options";
import { type BaseUnit, COMMON_PRESENTATIONS, UNIT_DEFS } from "@/lib/domain/units";
import type { Product } from "@/lib/services/types";

interface Props {
  open: boolean;
  onClose: () => void;
  product?: Product;
  categories: string[];
  /** Valores iniciales (por ejemplo, propuestos por el asistente o una factura). */
  initial?: Partial<ProductFormValues>;
  onCreated?: (productId: string, name: string) => void;
}

interface PresentationRow {
  key: number;
  name: string;
  factor: string;
}

export function ProductFormModal({ open, onClose, product, categories, initial, onCreated }: Props) {
  const router = useRouter();
  const editing = Boolean(product);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [baseUnit, setBaseUnit] = useState<BaseUnit>("unidad");
  const [minStock, setMinStock] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [tracksExpiry, setTracksExpiry] = useState(false);
  const [lotCode, setLotCode] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [description, setDescription] = useState("");
  const [barcode, setBarcode] = useState("");
  const [presentations, setPresentations] = useState<PresentationRow[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? initial?.name ?? "");
    setCategory(product?.category ?? initial?.category ?? "");
    setBaseUnit((product?.baseUnit ?? (initial?.baseUnit as BaseUnit | undefined) ?? "unidad") as BaseUnit);
    setMinStock(product ? formatNumber(product.minStock).replace(/\./g, "") : String(initial?.minStock ?? ""));
    setUnitCost(product?.unitCost != null ? String(product.unitCost).replace(".", ",") : String(initial?.unitCost ?? ""));
    setInitialStock(String(initial?.initialStock ?? ""));
    setTracksExpiry(product?.tracksExpiry ?? Boolean(initial?.tracksExpiry));
    setLotCode("");
    setExpiresOn("");
    setDescription(product?.description ?? initial?.description ?? "");
    setBarcode(product?.barcode ?? "");
    setPresentations(
      (initial?.presentations ?? []).map((p, i) => ({ key: i, name: p.name, factor: String(p.factor ?? "") })),
    );
  }, [open, product, initial]);

  const action = useConfirmableAction<ProductFormValues, { productId: string; name?: string }>(
    async (values) => (editing ? updateProductAction(product!.id, values) : createProductAction(values)),
    {
      ackField: "acknowledgeSimilar",
      onSuccess: (data, message) => {
        toast.success(message ?? "Guardado.");
        onClose();
        const created = data as { productId?: string; name?: string };
        if (!editing && created?.productId) {
          if (onCreated) onCreated(created.productId, created.name ?? name);
          else router.push(`/inventario/${created.productId}`);
        }
        router.refresh();
      },
    },
  );

  useEffect(() => {
    if (!open) action.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unitDef = UNIT_DEFS[baseUnit];
  const submit = () =>
    action.submit({
      name,
      category: category || null,
      baseUnit,
      minStock,
      unitCost,
      initialStock: editing ? undefined : initialStock,
      tracksExpiry,
      initialLotCode: lotCode || null,
      initialExpiresOn: expiresOn || null,
      description: description || null,
      barcode: barcode || null,
      presentations: editing ? undefined : presentations.map((p) => ({ name: p.name, factor: p.factor })),
      source: initial?.source,
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? "Editar producto" : "Nuevo producto"}
      description={editing ? product?.name : "Cargá los datos básicos; las presentaciones (caja, tubo…) se pueden agregar después."}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={action.pending || !name.trim()}>
            {action.pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Guardar cambios" : "Crear producto"}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Nombre" htmlFor="p-name" hint="Incluí lo que lo distingue: medida, color, marca o talle.">
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Ej.: Jeringa descartable 5 ml" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría" htmlFor="p-cat" optional>
            <Input id="p-cat" list="categorias" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} placeholder="Ej.: Descartables" />
            <datalist id="categorias">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field
            label="Unidad de medida"
            htmlFor="p-unit"
            hint={editing ? "Solo se puede cambiar si el producto no tiene movimientos." : "El stock siempre se guarda en esta unidad."}
          >
            <Select id="p-unit" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value as BaseUnit)}>
              {BASE_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {!editing && (
            <Field label={`Stock actual (${unitDef.plural})`} htmlFor="p-stock" optional>
              <NumberInput id="p-stock" value={initialStock} onChange={(e) => setInitialStock(e.target.value)} placeholder="0" />
            </Field>
          )}
          <Field label={`Stock mínimo (${unitDef.plural})`} htmlFor="p-min" hint="Debajo de esto se avisa «stock bajo».">
            <NumberInput id="p-min" value={minStock} onChange={(e) => setMinStock(e.target.value)} placeholder="0" />
          </Field>
          <Field label={`Costo por ${unitDef.singular} ($)`} htmlFor="p-cost" optional hint="Se actualiza solo con cada compra.">
            <NumberInput id="p-cost" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="Ej.: 1.250,50" />
          </Field>
        </div>

        <Checkbox
          label={
            <span>
              <span className="font-medium">Controlar lotes y vencimientos</span>
              <span className="block text-muted">Recomendado para anestésicos, resinas, adhesivos, cementos y medicamentos.</span>
            </span>
          }
          checked={tracksExpiry}
          onChange={(e) => setTracksExpiry(e.target.checked)}
        />
        {tracksExpiry && !editing && Number(initialStock.replace(",", ".")) > 0 && (
          <div className="grid gap-4 rounded-2xl bg-slate-50 p-3 sm:grid-cols-2">
            <Field label="Lote del stock actual" htmlFor="p-lot" optional>
              <Input id="p-lot" value={lotCode} onChange={(e) => setLotCode(e.target.value)} maxLength={60} />
            </Field>
            <Field label="Vencimiento" htmlFor="p-exp" optional>
              <Input id="p-exp" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </Field>
          </div>
        )}

        {!editing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Presentaciones</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPresentations((p) => [...p, { key: Date.now(), name: "", factor: "" }])}
              >
                <Plus className="h-4 w-4" /> Agregar
              </Button>
            </div>
            {presentations.length === 0 && (
              <p className="text-sm text-muted">
                Por ejemplo: 1 caja = 100 {unitDef.plural}. Sin equivalencia definida, el sistema no convierte cajas a {unitDef.plural}.
              </p>
            )}
            {presentations.map((row, idx) => (
              <div key={row.key} className="flex items-end gap-2">
                <Field label={idx === 0 ? "Nombre" : ""} className="flex-1">
                  <Input
                    list="presentaciones-comunes"
                    value={row.name}
                    onChange={(e) => setPresentations((list) => list.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))}
                    placeholder="caja"
                    aria-label="Nombre de la presentación"
                  />
                </Field>
                <span className="pb-3 text-sm text-muted">=</span>
                <Field label={idx === 0 ? `${unitDef.plural}` : ""} className="w-32">
                  <NumberInput
                    value={row.factor}
                    onChange={(e) => setPresentations((list) => list.map((r) => (r.key === row.key ? { ...r, factor: e.target.value } : r)))}
                    placeholder="100"
                    aria-label={`Cantidad de ${unitDef.plural} por presentación`}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Quitar presentación"
                  onClick={() => setPresentations((list) => list.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <datalist id="presentaciones-comunes">
              {COMMON_PRESENTATIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
        )}

        <details className="rounded-2xl border border-line px-3.5 py-2.5">
          <summary className="cursor-pointer text-sm font-medium">Más datos (descripción, código)</summary>
          <div className="mt-3 space-y-4">
            <Field label="Descripción" htmlFor="p-desc" optional>
              <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
            </Field>
            <Field label="Código o código de barras" htmlFor="p-code" optional>
              <Input id="p-code" value={barcode} onChange={(e) => setBarcode(e.target.value)} maxLength={60} />
            </Field>
          </div>
        </details>
        <button type="submit" className="hidden" />
        <ActionFeedback state={action} onConfirm={action.confirm} pending={action.pending} confirmLabel="Sí, es otro producto: crear igual" />
      </form>
    </Modal>
  );
}
