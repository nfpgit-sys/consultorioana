"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createExpenseAction } from "@/app/(app)/actions";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { useConfirmableAction } from "@/components/forms/use-confirmable-action";
import { Button } from "@/components/ui/button";
import { Field, Input, NumberInput, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { todayAR } from "@/lib/domain/format";
import { normalizeName } from "@/lib/domain/normalize";
import { DOC_TYPE_LABELS, DOC_TYPES } from "@/lib/services/documents-types";
import type { Supplier } from "@/lib/services/types";

export function ExpenseFormModal({
  open,
  onClose,
  categories,
  suppliers,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(todayAR());
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [docType, setDocType] = useState("");
  const [docNumber, setDocNumber] = useState("");

  useEffect(() => {
    if (open) {
      setDate(todayAR());
      setCategory("");
      setDescription("");
      setAmount("");
      setSupplierName("");
      setDocType("");
      setDocNumber("");
    }
  }, [open]);

  const action = useConfirmableAction(createExpenseAction, {
    onSuccess: (data) => {
      const d = data as { number: number; duplicate?: boolean };
      toast.success(d.duplicate ? "Ese gasto ya estaba registrado." : `Gasto #${d.number} registrado.`);
      onClose();
      router.refresh();
    },
  });
  useEffect(() => {
    if (!open) action.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const existing = suppliers.find((s) => normalizeName(s.name) === normalizeName(supplierName));
  const submit = () =>
    action.submit({
      expenseDate: date,
      category,
      description,
      amount,
      supplierId: existing?.id ?? null,
      supplierName: existing ? null : supplierName || null,
      docType: docType || null,
      docNumber: docNumber || null,
      source: "manual",
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo gasto"
      description="Gastos que no incorporan productos al inventario (alquiler, servicios, laboratorio…)."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={action.pending || !category.trim() || !description.trim() || !amount}>
            {action.pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Registrar gasto
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Importe ($)" htmlFor="g-a">
            <NumberInput id="g-a" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus />
          </Field>
          <Field label="Fecha" htmlFor="g-d">
            <Input id="g-d" type="date" value={date} max={todayAR()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Categoría" htmlFor="g-c">
          <Input id="g-c" list="cat-gastos" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ej.: Luz" maxLength={80} />
          <datalist id="cat-gastos">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Descripción" htmlFor="g-desc">
          <Input id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Ej.: factura Edesur de octubre" />
        </Field>
        <details className="rounded-2xl border border-line px-3.5 py-2.5">
          <summary className="cursor-pointer text-sm font-medium">Proveedor y comprobante (opcional)</summary>
          <div className="mt-3 space-y-3">
            <Field label="Proveedor" htmlFor="g-s" hint={supplierName && !existing ? "Se crea como proveedor nuevo." : undefined}>
              <Input id="g-s" list="g-proveedores" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              <datalist id="g-proveedores">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Comprobante" htmlFor="g-t">
                <Select id="g-t" value={docType} onChange={(e) => setDocType(e.target.value)}>
                  <option value="">—</option>
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DOC_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Número" htmlFor="g-n">
                <Input id="g-n" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
              </Field>
            </div>
          </div>
        </details>
        <button type="submit" className="hidden" />
        <ActionFeedback state={action} onConfirm={action.confirm} pending={action.pending} />
      </form>
    </Modal>
  );
}
