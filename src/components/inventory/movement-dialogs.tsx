"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { adjustStockAction, registerMovementsAction, reverseMovementAction } from "@/app/(app)/actions";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { useConfirmableAction } from "@/components/forms/use-confirmable-action";
import { Button } from "@/components/ui/button";
import { Field, Input, NumberInput, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { formatDate, formatQuantity, todayAR } from "@/lib/domain/format";
import { parseDecimalAR } from "@/lib/domain/numbers";
import { stockWithPresentations, unitOptionsFor } from "@/lib/domain/unit-options";
import { toBaseQuantity } from "@/lib/domain/units";
import type { Lot, Movement, Product } from "@/lib/services/types";

type MovementProduct = Pick<Product, "id" | "name" | "baseUnit" | "currentStock" | "presentations" | "tracksExpiry">;

export function MovementModal({
  open,
  onClose,
  product,
  kind,
  lots = [],
}: {
  open: boolean;
  onClose: () => void;
  product: MovementProduct;
  kind: "consumo" | "ingreso";
  lots?: Lot[];
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayAR());
  const [lotId, setLotId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [expiresOn, setExpiresOn] = useState("");

  useEffect(() => {
    if (open) {
      setQuantity("");
      setUnit("");
      setReason("");
      setDate(todayAR());
      setLotId("");
      setLotCode("");
      setExpiresOn("");
    }
  }, [open]);

  const action = useConfirmableAction(registerMovementsAction, {
    onSuccess: (data, message) => {
      toast.success((data as { duplicate?: boolean }).duplicate ? "Ya estaba registrado: no se duplicó." : (message ?? "Registrado."));
      onClose();
      router.refresh();
    },
  });
  useEffect(() => {
    if (!open) action.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const units = useMemo(() => unitOptionsFor(product.baseUnit, product.presentations), [product]);
  const preview = useMemo(() => {
    const q = parseDecimalAR(quantity);
    if (q === null || q <= 0) return null;
    const conv = toBaseQuantity({ name: product.name, baseUnit: product.baseUnit, presentations: product.presentations }, q, unit);
    if (!conv.ok) return { error: conv.error };
    const after = kind === "consumo" ? product.currentStock - conv.baseQuantity : product.currentStock + conv.baseQuantity;
    return { base: conv.baseQuantity, after };
  }, [quantity, unit, kind, product]);

  const submit = () =>
    action.submit({
      items: [
        {
          productId: product.id,
          quantity,
          unit: unit || null,
          kind,
          reason: reason || null,
          lotId: lotId || null,
          lotCode: lotCode || null,
          expiresOn: expiresOn || null,
        },
      ],
      effectiveDate: date,
      source: "manual",
    });

  const availableLots = lots.filter((l) => l.quantity > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === "consumo" ? "Registrar consumo" : "Registrar ingreso"}
      description={`${product.name} · stock actual: ${stockWithPresentations(product.currentStock, product.baseUnit, product.presentations)}`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={action.pending || !preview || "error" in preview} variant={kind === "consumo" ? "primary" : "primary"}>
            {action.pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {kind === "consumo" ? "Descontar del stock" : "Sumar al stock"}
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
          <Field label="Cantidad" htmlFor="mv-q">
            <NumberInput id="mv-q" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus placeholder="0" />
          </Field>
          <Field label="Unidad" htmlFor="mv-u">
            <Select id="mv-u" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {units.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {preview && "error" in preview && <p className="text-sm text-rose-700">{preview.error}</p>}
        {preview && !("error" in preview) && (
          <p className={preview.after < 0 ? "text-sm font-medium text-rose-700" : "text-sm text-muted"}>
            {kind === "consumo" ? "Se descuentan" : "Se suman"} {formatQuantity(preview.base, product.baseUnit)}. Stock resultante:{" "}
            <strong className="text-ink">{formatQuantity(Math.max(preview.after, 0), product.baseUnit)}</strong>
            {preview.after < 0 && " — no alcanza el stock registrado."}
          </p>
        )}
        {product.tracksExpiry && kind === "consumo" && availableLots.length > 0 && (
          <Field label="Lote" htmlFor="mv-lot" hint="Si no elegís, se descuenta primero el que vence antes.">
            <Select id="mv-lot" value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">Automático (vence antes primero)</option>
              {availableLots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lotCode ?? "Sin número"} · vence {l.expiresOn ? formatDate(l.expiresOn) : "—"} · {formatQuantity(l.quantity, product.baseUnit)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {product.tracksExpiry && kind === "ingreso" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lote" htmlFor="mv-lc" optional>
              <Input id="mv-lc" value={lotCode} onChange={(e) => setLotCode(e.target.value)} maxLength={60} />
            </Field>
            <Field label="Vencimiento" htmlFor="mv-exp" optional>
              <Input id="mv-exp" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Motivo o detalle" htmlFor="mv-r" optional>
            <Input
              id="mv-r"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder={kind === "consumo" ? "Ej.: tratamiento de conducto" : "Ej.: muestra gratis"}
            />
          </Field>
          <Field label="Fecha" htmlFor="mv-d">
            <Input id="mv-d" type="date" value={date} max={todayAR()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {kind === "ingreso" && (
          <p className="text-sm text-muted">
            Si fue una compra, conviene registrarla en <strong>Compras</strong> para guardar proveedor y precio.
          </p>
        )}
        <button type="submit" className="hidden" />
        <ActionFeedback state={action} onConfirm={action.confirm} pending={action.pending} />
      </form>
    </Modal>
  );
}

export function AdjustModal({ open, onClose, product, lots = [] }: { open: boolean; onClose: () => void; product: MovementProduct; lots?: Lot[] }) {
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [lotId, setLotId] = useState("");
  useEffect(() => {
    if (open) {
      setCounted("");
      setReason("");
      setLotId(lots.length === 1 ? lots[0].id : "");
    }
  }, [open, lots]);
  const action = useConfirmableAction(adjustStockAction, {
    onSuccess: (_d, message) => {
      toast.success(message ?? "Ajuste registrado.");
      onClose();
      router.refresh();
    },
  });
  useEffect(() => {
    if (!open) action.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const selectedLot = lots.find((l) => l.id === lotId);
  const reference = product.tracksExpiry ? (selectedLot?.quantity ?? null) : product.currentStock;
  const n = parseDecimalAR(counted);
  const submit = () => action.submit({ productId: product.id, newStock: counted, reason, lotId: lotId || null, source: "manual" });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajustar stock"
      description="Usalo después de un conteo o para corregir diferencias. Queda registrado con su motivo."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={action.pending || n === null || reason.trim().length < 3 || (product.tracksExpiry && !lotId)}>
            {action.pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Registrar ajuste
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
        {product.tracksExpiry && (
          <Field label="Lote a ajustar" htmlFor="aj-lot">
            <Select id="aj-lot" value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">Elegí un lote</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lotCode ?? "Sin número"} · vence {l.expiresOn ? formatDate(l.expiresOn) : "—"} · {formatQuantity(l.quantity, product.baseUnit)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label={`Cantidad contada (${formatQuantity(2, product.baseUnit).replace(/^2 /, "")})`}
          htmlFor="aj-n"
          hint={reference !== null ? `Registrado actualmente: ${formatQuantity(reference, product.baseUnit)}` : undefined}
        >
          <NumberInput id="aj-n" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        </Field>
        {n !== null && reference !== null && (
          <p className="text-sm text-muted">
            Diferencia: <strong className="text-ink">{n - reference > 0 ? "+" : ""}{formatQuantity(n - reference, product.baseUnit)}</strong>
          </p>
        )}
        <Field label="Motivo" htmlFor="aj-r">
          <Input id="aj-r" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ej.: conteo mensual" />
        </Field>
        <button type="submit" className="hidden" />
        <ActionFeedback state={action} onConfirm={action.confirm} pending={action.pending} />
      </form>
    </Modal>
  );
}

export function ReverseModal({ open, onClose, movement }: { open: boolean; onClose: () => void; movement: Pick<Movement, "id" | "number" | "productName" | "quantity" | "baseUnit"> }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const action = useConfirmableAction(reverseMovementAction, {
    onSuccess: (_d, message) => {
      toast.success(message ?? "Revertido.");
      onClose();
      router.refresh();
    },
  });
  useEffect(() => {
    if (!open) action.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = () => action.submit({ movementId: movement.id, reason, source: "manual" });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Revertir movimiento #${movement.number}`}
      description={`${movement.productName}: ${movement.quantity > 0 ? "+" : ""}${formatQuantity(movement.quantity, movement.baseUnit)}`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={submit} disabled={action.pending || reason.trim().length < 3}>
            {action.pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Revertir
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Se registra un movimiento nuevo de signo contrario ({movement.quantity > 0 ? "−" : "+"}
          {formatQuantity(Math.abs(movement.quantity), movement.baseUnit)}). El movimiento original no se borra.
        </p>
        <Field label="Motivo" htmlFor="rv-r">
          <Input id="rv-r" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ej.: lo cargué dos veces" autoFocus />
        </Field>
        <ActionFeedback state={action} onConfirm={action.confirm} pending={action.pending} />
      </div>
    </Modal>
  );
}
