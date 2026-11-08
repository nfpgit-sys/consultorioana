"use client";

import { Mic, MessageSquareText, FileScan, Hand, RotateCcw, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { formatDate, formatDateTime, formatNumber, formatQuantity } from "@/lib/domain/format";
import { quantityUnitLabel, unitLabel } from "@/lib/domain/units";
import { MOVEMENT_KIND_LABELS, type Movement } from "@/lib/services/types";
import { ReverseModal } from "./movement-dialogs";

const KIND_TONE: Record<Movement["kind"], "success" | "danger" | "info" | "warning" | "neutral" | "brand"> = {
  stock_inicial: "neutral",
  compra: "success",
  ingreso: "success",
  consumo: "danger",
  ajuste: "warning",
  reversion: "info",
  vencimiento: "danger",
};

const SOURCE_ICON = {
  manual: Hand,
  texto: MessageSquareText,
  voz: Mic,
  factura: FileScan,
  sistema: Settings2,
} as const;

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  texto: "Asistente",
  voz: "Voz",
  factura: "Factura",
  sistema: "Sistema",
};

export function MovementList({ movements, showProduct = true, compact = false }: { movements: Movement[]; showProduct?: boolean; compact?: boolean }) {
  const [reversing, setReversing] = useState<Movement | null>(null);
  if (movements.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted sm:px-5">Sin movimientos.</p>;
  return (
    <>
      <ul className="divide-y divide-line">
        {movements.map((m) => {
          const SourceIcon = SOURCE_ICON[m.source as keyof typeof SOURCE_ICON] ?? Hand;
          const canReverse = !compact && m.kind !== "reversion" && !m.reversedByNumber && !m.purchaseId;
          const positive = m.quantity > 0;
          const createdDate = formatDateTime(m.createdAt);
          return (
            <li key={m.id} className={cn("flex gap-3 px-4 py-3 sm:px-5", m.reversedByNumber && "bg-slate-50/70")}>
              <div
                className={cn(
                  "tabular mt-0.5 w-20 shrink-0 text-right text-[0.95rem] font-semibold sm:w-24",
                  positive ? "text-emerald-700" : "text-rose-700",
                  m.reversedByNumber && "text-slate-400 line-through",
                )}
              >
                {positive ? "+" : "−"}
                {formatNumber(Math.abs(m.quantity))}
                <span className="block text-xs font-normal text-muted no-underline">{unitLabel(m.baseUnit, m.quantity)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={KIND_TONE[m.kind]}>{MOVEMENT_KIND_LABELS[m.kind]}</Badge>
                  {showProduct && (
                    <Link href={`/inventario/${m.productId}`} className="truncate font-medium text-ink hover:text-brand-700">
                      {m.productName}
                    </Link>
                  )}
                  {m.lotCode !== null || m.lotExpiresOn ? (
                    <span className="text-xs text-muted">
                      Lote {m.lotCode ?? "s/n"}
                      {m.lotExpiresOn ? ` · vence ${formatDate(m.lotExpiresOn)}` : ""}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {m.inputUnit && m.inputQuantity !== null && m.inputUnit !== unitLabel(m.baseUnit, m.inputQuantity)
                    ? `${formatNumber(m.inputQuantity)} ${quantityUnitLabel(m.inputQuantity, m.inputUnit)} · `
                    : ""}
                  Stock: {formatNumber(m.stockBefore)} → <span className="font-medium text-ink">{formatQuantity(m.stockAfter, m.baseUnit)}</span>
                </p>
                {m.reason && <p className="mt-0.5 text-sm text-slate-700">{m.reason}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span>#{m.number}</span>
                  <span>{createdDate}</span>
                  {m.effectiveDate !== m.createdAt.slice(0, 10) && formatDate(m.effectiveDate) !== createdDate.slice(0, 10) && (
                    <span>(fecha del hecho: {formatDate(m.effectiveDate)})</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <SourceIcon className="h-3.5 w-3.5" aria-hidden /> {SOURCE_LABEL[m.source] ?? m.source}
                  </span>
                  {m.actor && <span>· {m.actor}</span>}
                  {m.purchaseNumber && (
                    <Link href={`/compras/${m.purchaseId}`} className="text-brand-700 hover:underline">
                      Compra #{m.purchaseNumber}
                    </Link>
                  )}
                  {m.reversesNumber && <span>Revierte #{m.reversesNumber}</span>}
                  {m.reversedByNumber && <span className="font-medium text-slate-600">Revertido por #{m.reversedByNumber}</span>}
                </p>
              </div>
              {canReverse && (
                <div className="shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setReversing(m)} aria-label={`Revertir movimiento ${m.number}`}>
                    <RotateCcw className="h-4 w-4" />
                    <span className="hidden sm:inline">Revertir</span>
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {reversing && <ReverseModal open onClose={() => setReversing(null)} movement={reversing} />}
    </>
  );
}
