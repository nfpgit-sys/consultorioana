"use client";

import { Ban, Loader2, ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completePurchasePricesAction, voidPurchaseAction } from "@/app/(app)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, NumberInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { formatARS, formatNumber } from "@/lib/domain/format";
import { parseDecimalAR } from "@/lib/domain/numbers";
import type { PurchaseDetail } from "@/lib/services/purchases";

export function PurchaseActions({ purchase }: { purchase: PurchaseDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState<"anular" | "precios" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [tax, setTax] = useState("");
  if (purchase.status === "anulada") return null;

  const pendingItems = purchase.items.filter((i) => i.lineTotal === null);
  const sum = purchase.items.reduce((acc, i) => acc + (i.lineTotal ?? parseDecimalAR(amounts[i.id] ?? "") ?? 0), 0);

  return (
    <>
      {purchase.status === "pendiente_precio" && (
        <Button onClick={() => setOpen("precios")}>
          <ReceiptText className="h-5 w-5" /> Completar precios
        </Button>
      )}
      <Button variant="outline" onClick={() => setOpen("anular")}>
        <Ban className="h-5 w-5" /> Anular
      </Button>

      <Modal
        open={open === "anular"}
        onClose={() => setOpen(null)}
        title={`Anular compra #${purchase.number}`}
        description="Se revierte el stock que incorporó. La compra y sus movimientos quedan en el historial."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                startTransition(async () => {
                  const res = await voidPurchaseAction(purchase.id, reason);
                  if (res.ok) {
                    toast.success(res.message ?? "Anulada.");
                    setOpen(null);
                    router.refresh();
                  } else setError(res.error);
                })
              }
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Anular compra
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Motivo" htmlFor="an-r">
            <Input id="an-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: se cargó dos veces" autoFocus />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <Modal
        open={open === "precios"}
        onClose={() => setOpen(null)}
        title="Completar precios"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setOpen(null)}>
              Cancelar
            </Button>
            <Button
              disabled={pending || pendingItems.some((i) => parseDecimalAR(amounts[i.id] ?? "") === null)}
              onClick={() =>
                startTransition(async () => {
                  const res = await completePurchasePricesAction(purchase.id, {
                    items: pendingItems.map((i) => ({ itemId: i.id, lineTotal: amounts[i.id] })),
                    taxAmount: tax || null,
                  });
                  if (res.ok) {
                    toast.success(res.message ?? "Listo.");
                    setOpen(null);
                    router.refresh();
                  } else setError(res.error);
                })
              }
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar precios
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {pendingItems.map((i) => (
            <Field key={i.id} label={`${i.productName ?? i.description} · ${formatNumber(i.quantity)} ${i.unit}`}>
              <NumberInput value={amounts[i.id] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [i.id]: e.target.value }))} placeholder="Importe de la línea $" />
            </Field>
          ))}
          <Field label="IVA / impuestos" optional>
            <NumberInput value={tax} onChange={(e) => setTax(e.target.value)} placeholder="$" />
          </Field>
          <p className="text-sm text-muted">Total: {formatARS(sum + (parseDecimalAR(tax) ?? 0))}</p>
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>
    </>
  );
}
