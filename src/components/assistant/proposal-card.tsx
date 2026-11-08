"use client";

import { AlertTriangle, Check, CheckCircle2, Loader2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addPresentationAction,
  adjustStockAction,
  createExpenseAction,
  createProductAction,
  createPurchaseAction,
  registerMovementsAction,
  reverseMovementAction,
} from "@/app/(app)/actions";
import { Badge, StockBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Checkbox, Input, NumberInput } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import type { Proposal } from "@/lib/agent/types";
import { formatARS, formatDate, formatNumber, formatQuantity } from "@/lib/domain/format";
import { parseDecimalAR } from "@/lib/domain/numbers";
import { UNIT_DEFS, unitLabel } from "@/lib/domain/units";
import type { ActionResult } from "@/lib/server/action";

export type ProposalStatus =
  | { state: "pendiente" }
  | { state: "confirmada"; detail: string; href?: string; movementIds?: string[] }
  | { state: "cancelada" }
  | { state: "deshecha" };

export function ProposalCard({
  proposal,
  status,
  source,
  onStatus,
}: {
  proposal: Proposal;
  status: ProposalStatus;
  source: "texto" | "voz";
  onStatus: (s: ProposalStatus) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  // Campos editables antes de confirmar
  const [name, setName] = useState(proposal.type === "producto" ? proposal.input.name : "");
  const [supplier, setSupplier] = useState(proposal.type === "compra" ? (proposal.input.supplierName ?? "") : "");
  const [amount, setAmount] = useState(proposal.type === "compra" && proposal.total !== null ? String(proposal.total).replace(".", ",") : "");

  const needsAck = proposal.warnings.some((w) => w.requiresAck) || serverWarnings.length > 0;
  const disabled = status.state !== "pendiente";

  const handle = (res: ActionResult<unknown>, onOk: (data: Record<string, unknown>) => ProposalStatus) => {
    if (res.ok) {
      const next = onOk(res.data as Record<string, unknown>);
      onStatus(next);
      toast.success((res.data as { duplicate?: boolean })?.duplicate ? "Ya estaba registrado: no se duplicó." : "Registrado.");
      router.refresh();
    } else if (res.code === "requiere_confirmacion" || res.code === "producto_similar") {
      setServerWarnings((res.warnings ?? []).filter((w) => w.requiresAck).map((w) => w.message).concat(res.code === "producto_similar" ? [res.error] : []));
      setError(null);
    } else {
      setError(res.error);
    }
  };

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      const common = { idempotencyKey: proposal.id, source, acknowledgeWarnings: ack };
      switch (proposal.type) {
        case "movimientos": {
          const res = await registerMovementsAction({ ...common, items: proposal.input.items, effectiveDate: proposal.input.effectiveDate });
          handle(res, (d) => {
            const movements = (d.movements as { id: string; number: number }[]) ?? [];
            return {
              state: "confirmada",
              detail: movements.length ? `Movimiento${movements.length > 1 ? "s" : ""} ${movements.map((m) => `#${m.number}`).join(", ")}` : "Registrado",
              href: proposal.lines.length === 1 ? `/inventario/${proposal.lines[0].productId}` : "/movimientos",
              movementIds: movements.map((m) => m.id),
            };
          });
          break;
        }
        case "compra": {
          const total = amount.trim() ? amount : null;
          const singleLine = proposal.input.items.length === 1;
          const res = await createPurchaseAction({
            ...common,
            supplierName: supplier.trim() || null,
            purchaseDate: proposal.input.purchaseDate,
            docNumber: proposal.input.docNumber,
            items: proposal.input.items.map((i) => ({
              ...i,
              lineTotal: i.lineTotal ?? (singleLine && total ? total : null),
              unitPrice: i.unitPrice,
            })),
            total: singleLine ? null : total,
          });
          handle(res, (d) => ({ state: "confirmada", detail: `Compra #${d.number}${d.status === "pendiente_precio" ? " (pendiente de precio)" : ""}`, href: `/compras/${d.purchaseId}` }));
          break;
        }
        case "gasto": {
          const res = await createExpenseAction({ ...common, ...proposal.input });
          handle(res, (d) => ({ state: "confirmada", detail: `Gasto #${d.number}`, href: "/gastos" }));
          break;
        }
        case "producto": {
          const res = await createProductAction({
            idempotencyKey: proposal.id,
            source,
            acknowledgeSimilar: ack,
            name: name.trim() || proposal.input.name,
            category: proposal.input.category,
            baseUnit: proposal.input.baseUnit,
            initialStock: proposal.input.initialStock,
            minStock: proposal.input.minStock,
            unitCost: proposal.input.unitCost,
            tracksExpiry: proposal.input.tracksExpiry,
            presentations: proposal.input.presentations,
          });
          handle(res, (d) => ({ state: "confirmada", detail: `Producto creado: ${d.name}`, href: `/inventario/${d.productId}` }));
          break;
        }
        case "ajuste": {
          const res = await adjustStockAction({ ...common, ...proposal.input });
          handle(res, () => ({ state: "confirmada", detail: "Ajuste registrado", href: `/inventario/${proposal.input.productId}` }));
          break;
        }
        case "reversion": {
          const res = await reverseMovementAction({ idempotencyKey: proposal.id, source, ...proposal.input });
          handle(res, (d) => ({ state: "confirmada", detail: `Revertido el movimiento #${d.reversedNumber}`, href: "/movimientos" }));
          break;
        }
        case "presentacion": {
          const res = await addPresentationAction(proposal.input.productId, proposal.input.name, proposal.input.factor);
          handle(res, () => ({ state: "confirmada", detail: "Presentación agregada", href: `/inventario/${proposal.input.productId}` }));
          break;
        }
      }
    });

  const undo = () =>
    startTransition(async () => {
      if (status.state !== "confirmada" || !status.movementIds?.length) return;
      if (!window.confirm("¿Deshacer? Se registra el movimiento contrario; el original queda en el historial.")) return;
      for (const id of status.movementIds) {
        const res = await reverseMovementAction({ movementId: id, reason: "Deshecho desde el asistente", idempotencyKey: `deshacer-${id}`, source });
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }
      onStatus({ state: "deshecha" });
      toast.success("Deshecho.");
      router.refresh();
    });

  return (
    <div
      className={cn(
        "mt-2 overflow-hidden rounded-2xl border bg-white text-sm shadow-[var(--shadow-card)]",
        status.state === "confirmada" ? "border-emerald-200" : status.state === "pendiente" ? "border-brand-200" : "border-line opacity-75",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-slate-50/70 px-3.5 py-2.5">
        <p className="font-semibold">{proposal.title}</p>
        {status.state === "pendiente" && <Badge tone="brand">Para confirmar</Badge>}
        {status.state === "confirmada" && <Badge tone="success">Registrado</Badge>}
        {status.state === "cancelada" && <Badge>Cancelado</Badge>}
        {status.state === "deshecha" && <Badge tone="info">Deshecho</Badge>}
      </div>
      <div className="space-y-2 px-3.5 py-3">
        <ProposalBody proposal={proposal} editable={!disabled} name={name} setName={setName} supplier={supplier} setSupplier={setSupplier} amount={amount} setAmount={setAmount} />
        {proposal.warnings.length > 0 && (
          <ul className="space-y-1">
            {proposal.warnings.map((w) => (
              <li key={w.code + w.message} className={cn("flex gap-1.5", w.requiresAck ? "text-amber-800" : "text-muted")}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {w.message}
              </li>
            ))}
          </ul>
        )}
        {serverWarnings.map((w) => (
          <p key={w} className="flex gap-1.5 text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {w}
          </p>
        ))}
        {error && <p className="text-rose-700">{error}</p>}
        {status.state === "pendiente" && needsAck && (
          <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} label="Revisé las advertencias y quiero confirmar igualmente." />
        )}
      </div>
      {status.state === "pendiente" ? (
        <div className="flex gap-2 border-t border-line px-3.5 py-2.5">
          <Button size="sm" onClick={confirm} disabled={pending || (needsAck && !ack)} className="flex-1">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmar
          </Button>
          <Button size="sm" variant="outline" onClick={() => onStatus({ state: "cancelada" })} disabled={pending}>
            <X className="h-4 w-4" /> Cancelar
          </Button>
        </div>
      ) : status.state === "confirmada" ? (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-2.5 text-emerald-800">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> {status.detail}
          </span>
          <span className="flex items-center gap-3">
            {status.movementIds && status.movementIds.length > 0 && (
              <button type="button" onClick={undo} disabled={pending} className="inline-flex items-center gap-1 text-slate-600 hover:text-ink">
                <Undo2 className="h-3.5 w-3.5" /> Deshacer
              </button>
            )}
            {status.href && (
              <Link href={status.href} className="font-medium text-brand-700 hover:underline">
                Ver
              </Link>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ProposalBody({
  proposal,
  editable,
  name,
  setName,
  supplier,
  setSupplier,
  amount,
  setAmount,
}: {
  proposal: Proposal;
  editable: boolean;
  name: string;
  setName: (v: string) => void;
  supplier: string;
  setSupplier: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
}) {
  switch (proposal.type) {
    case "movimientos":
      return (
        <ul className="space-y-1.5">
          {proposal.lines.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium">{l.productName}</span>
                <span className="block text-muted">
                  {l.kind === "consumo" ? "Consumo" : "Ingreso"}: {l.inputLabel}
                  {l.inputLabel !== formatQuantity(l.baseQuantity, l.baseUnit) ? ` (= ${formatQuantity(l.baseQuantity, l.baseUnit)})` : ""}
                </span>
              </span>
              <span className="tabular shrink-0 text-right">
                {formatNumber(l.stockBefore)} → <strong>{formatNumber(l.stockAfter)}</strong>
                <span className="block">
                  <StockBadge status={l.statusAfter} />
                </span>
              </span>
            </li>
          ))}
          {proposal.input.effectiveDate && <li className="text-muted">Fecha del hecho: {formatDate(proposal.input.effectiveDate)}</li>}
        </ul>
      );
    case "compra":
      return (
        <div className="space-y-2">
          <ul className="space-y-1">
            {proposal.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {l.inputLabel} · <span className="font-medium">{l.label}</span>
                  {l.stockAfter !== null && <span className="block text-muted">Stock resultante: {formatNumber(l.stockAfter)}</span>}
                </span>
                <span className="tabular shrink-0">{l.lineTotal !== null ? formatARS(l.lineTotal) : "—"}</span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">
              Proveedor
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={!editable} className="mt-1 h-9 text-sm" placeholder="Opcional" />
            </label>
            <label className="text-xs text-muted">
              Total pagado
              <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!editable} className="mt-1 h-9 text-sm" placeholder="Pendiente" />
            </label>
          </div>
          {editable && parseDecimalAR(amount) === null && <p className="text-xs text-muted">Sin total, la compra queda pendiente de precio (el stock se suma igual).</p>}
          {proposal.supplierIsNew && supplier && <p className="text-xs text-muted">Proveedor nuevo: se crea al confirmar.</p>}
        </div>
      );
    case "gasto":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted">Importe</dt>
          <dd className="tabular font-semibold">{formatARS(proposal.input.amount)}</dd>
          <dt className="text-muted">Categoría</dt>
          <dd>{proposal.input.category}</dd>
          <dt className="text-muted">Detalle</dt>
          <dd>{proposal.input.description}</dd>
          <dt className="text-muted">Fecha</dt>
          <dd>{formatDate(proposal.input.expenseDate)}</dd>
        </dl>
      );
    case "producto":
      return (
        <div className="space-y-1.5">
          <label className="block text-xs text-muted">
            Nombre (podés corregirlo)
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} className="mt-1 h-9 text-sm" />
          </label>
          <p className="text-muted">
            Se mide en {UNIT_DEFS[proposal.input.baseUnit].plural} · stock inicial {formatQuantity(proposal.input.initialStock, proposal.input.baseUnit)}
            {proposal.input.presentations.map((p) => ` · 1 ${p.name} = ${formatNumber(p.factor)} ${unitLabel(proposal.input.baseUnit, p.factor)}`).join("")}
          </p>
          <p className="text-xs text-muted">Categoría, costo y stock mínimo se pueden completar después desde el producto.</p>
        </div>
      );
    case "ajuste":
      return (
        <p>
          <span className="font-medium">{proposal.productName}</span>: {formatQuantity(proposal.stockBefore, proposal.baseUnit)} →{" "}
          <strong>{formatQuantity(proposal.stockAfter, proposal.baseUnit)}</strong>
          <span className="block text-muted">Motivo: {proposal.input.reason}</span>
        </p>
      );
    case "reversion":
      return (
        <p>
          {proposal.description}
          <span className="block text-muted">
            Stock: {formatNumber(proposal.stockBefore)} → <strong>{formatQuantity(proposal.stockAfter, proposal.baseUnit)}</strong> · Motivo: {proposal.input.reason}
          </span>
        </p>
      );
    case "presentacion":
      return (
        <p>
          {proposal.productName}: <strong>1 {proposal.input.name}</strong> = {formatNumber(proposal.input.factor)} {unitLabel(proposal.baseUnit, proposal.input.factor)}
        </p>
      );
  }
}
