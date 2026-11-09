"use client";

import { Archive, ArchiveRestore, Loader2, Minus, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addPresentationAction,
  archivePresentationAction,
  archiveProductAction,
  unarchiveProductAction,
  writeOffLotAction,
} from "@/app/(app)/actions";
import { Alert } from "@/components/ui/alert";
import { Badge, StockBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, NumberInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { formatARS, formatDate, formatNumber, formatQuantity, todayAR } from "@/lib/domain/format";
import { stockWithPresentations } from "@/lib/domain/unit-options";
import { UNIT_DEFS, unitLabel } from "@/lib/domain/units";
import type { PurchaseSummary } from "@/lib/services/purchases";
import type { Lot, Movement, Product } from "@/lib/services/types";
import { AdjustModal, MovementModal } from "./movement-dialogs";
import { MovementList } from "./movement-list";
import { ProductFormModal } from "./product-form";

function daysUntil(date: string): number {
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${todayAR()}T00:00:00Z`).getTime()) / 86_400_000);
}

export function ProductDetail({
  product,
  movements,
  totalMovements,
  lots,
  purchases,
  categories,
}: {
  product: Product;
  movements: Movement[];
  totalMovements: number;
  lots: Lot[];
  purchases: PurchaseSummary[];
  categories: string[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"editar" | "consumo" | "ingreso" | "ajuste" | "archivar" | "presentacion" | null>(null);
  const [pending, startTransition] = useTransition();
  const archived = Boolean(product.archivedAt);
  const unit = UNIT_DEFS[product.baseUnit];

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Listo.");
        router.refresh();
      } else toast.error(res.error ?? "No se pudo completar.");
    });

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[1.6rem] font-semibold tracking-tight">{product.name}</h1>
            {archived ? <Badge>Archivado</Badge> : <StockBadge status={product.status} />}
          </div>
          <p className="mt-1 text-sm text-muted">
            {product.category ?? "Sin categoría"} · se mide en {unit.plural}
            {product.tracksExpiry ? " · controla vencimientos" : ""}
          </p>
        </div>
        {!archived && (
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button onClick={() => setDialog("consumo")} disabled={product.currentStock <= 0}>
              <Minus className="h-5 w-5" /> Consumo
            </Button>
            <Button variant="secondary" onClick={() => setDialog("ingreso")}>
              <Plus className="h-5 w-5" /> Ingreso
            </Button>
            <Button variant="outline" onClick={() => setDialog("ajuste")}>
              <Scale className="h-5 w-5" /> Ajustar
            </Button>
            <Button variant="outline" onClick={() => setDialog("editar")}>
              <Pencil className="h-5 w-5" /> Editar
            </Button>
          </div>
        )}
      </div>

      {archived && (
        <Alert
          tone="info"
          className="mb-5"
          title="Producto archivado"
          action={
            <Button size="sm" variant="outline" onClick={() => run(() => unarchiveProductAction(product.id))} disabled={pending}>
              <ArchiveRestore className="h-4 w-4" /> Reactivar
            </Button>
          }
        >
          {product.archiveReason ? `Motivo: ${product.archiveReason}. ` : ""}El historial de movimientos se conserva.
        </Alert>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stock actual" value={formatQuantity(product.currentStock, product.baseUnit)} detail={stockWithPresentations(product.currentStock, product.baseUnit, product.presentations).split(" · ")[1]} />
        <Stat label="Stock mínimo" value={product.minStock > 0 ? formatQuantity(product.minStock, product.baseUnit) : "Sin definir"} />
        <Stat label={`Costo por ${unit.singular}`} value={product.unitCost !== null ? formatARS(product.unitCost) : "Sin costo"} detail="Promedio ponderado de compras" />
        <Stat label="Valor del stock" value={product.stockValue !== null ? formatARS(product.stockValue) : "—"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Historial de movimientos"
              description={`${totalMovements} movimiento${totalMovements === 1 ? "" : "s"} · los errores se corrigen con reversiones`}
              action={
                totalMovements > movements.length ? (
                  <Link href={`/movimientos?producto=${product.id}`} className="inline-flex min-h-6 items-center text-sm font-medium text-brand-700 hover:underline">
                    Ver todos
                  </Link>
                ) : undefined
              }
            />
            <MovementList movements={movements} showProduct={false} compact={archived} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Presentaciones"
              description={`Equivalencias en ${unit.plural}`}
              action={
                !archived ? (
                  <Button variant="ghost" size="sm" onClick={() => setDialog("presentacion")}>
                    <Plus className="h-4 w-4" /> Agregar
                  </Button>
                ) : undefined
              }
            />
            <CardBody className="space-y-2">
              {product.presentations.length === 0 ? (
                <p className="text-sm text-muted">
                  Sin presentaciones. Agregá, por ejemplo, «1 caja = 100 {unit.plural}» para poder registrar compras o consumos por caja.
                </p>
              ) : (
                product.presentations.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <span>
                      1 <strong>{p.name}</strong> = {formatNumber(p.factor)} {unitLabel(product.baseUnit, p.factor)}
                      {product.unitCost !== null && <span className="text-muted"> · {formatARS(p.factor * product.unitCost)}</span>}
                    </span>
                    {!archived && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Quitar presentación ${p.name}`}
                        onClick={() => run(() => archivePresentationAction(p.id))}
                        disabled={pending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          {product.tracksExpiry && (
            <Card>
              <CardHeader title="Lotes y vencimientos" description="Se descuenta primero el que vence antes" />
              <CardBody className="space-y-2">
                {lots.length === 0 ? (
                  <p className="text-sm text-muted">Sin lotes con stock.</p>
                ) : (
                  lots.map((l) => {
                    const days = l.expiresOn ? daysUntil(l.expiresOn) : null;
                    return (
                      <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                        <div>
                          <p className="font-medium">Lote {l.lotCode ?? "sin número"}</p>
                          <p className="text-muted">{l.expiresOn ? `Vence ${formatDate(l.expiresOn)}` : "Sin fecha de vencimiento"}</p>
                        </div>
                        <div className="text-right">
                          <p className="tabular font-medium">{formatQuantity(l.quantity, product.baseUnit)}</p>
                          {days !== null && (
                            <Badge tone={days < 0 ? "danger" : days <= 30 ? "danger" : days <= 60 ? "warning" : "success"}>
                              {days < 0 ? `Vencido hace ${-days} d` : days === 0 ? "Vence hoy" : `${days} días`}
                            </Badge>
                          )}
                          {days !== null && days < 0 && !archived && (
                            <button
                              type="button"
                              className="mt-1 block text-xs font-medium text-rose-700 hover:underline"
                              disabled={pending}
                              onClick={() => {
                                if (window.confirm(`¿Dar de baja ${formatQuantity(l.quantity, product.baseUnit)} del lote ${l.lotCode ?? "sin número"} por vencimiento?`)) {
                                  run(() => writeOffLotAction(l.id));
                                }
                              }}
                            >
                              Dar de baja
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Últimas compras" />
            <CardBody className="space-y-2">
              {purchases.length === 0 ? (
                <p className="text-sm text-muted">Sin compras registradas.</p>
              ) : (
                purchases.map((p) => (
                  <Link key={p.id} href={`/compras/${p.id}`} className="flex items-center justify-between rounded-xl px-1 py-1.5 text-sm hover:bg-slate-50">
                    <span>
                      #{p.number} · {formatDate(p.purchaseDate)}
                      <span className="block text-muted">{p.supplierName ?? "Sin proveedor"}</span>
                    </span>
                    <span className="tabular font-medium">{p.status === "anulada" ? <Badge>Anulada</Badge> : formatARS(p.total)}</span>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>

          {product.description && (
            <Card>
              <CardHeader title="Descripción" />
              <CardBody className="text-sm whitespace-pre-line text-slate-700">{product.description}</CardBody>
            </Card>
          )}

          {!archived && (
            <Button variant="ghost" className="w-full text-slate-600" onClick={() => setDialog("archivar")}>
              <Archive className="h-4 w-4" /> Archivar producto
            </Button>
          )}
        </div>
      </div>

      <ProductFormModal open={dialog === "editar"} onClose={() => setDialog(null)} product={product} categories={categories} />
      <MovementModal open={dialog === "consumo"} onClose={() => setDialog(null)} product={product} kind="consumo" lots={lots} />
      <MovementModal open={dialog === "ingreso"} onClose={() => setDialog(null)} product={product} kind="ingreso" lots={lots} />
      <AdjustModal open={dialog === "ajuste"} onClose={() => setDialog(null)} product={product} lots={lots} />
      <ArchiveModal open={dialog === "archivar"} onClose={() => setDialog(null)} productId={product.id} name={product.name} />
      <PresentationModal open={dialog === "presentacion"} onClose={() => setDialog(null)} productId={product.id} unitPlural={unit.plural} />
    </>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold">{value}</p>
      {detail && <p className="text-xs text-muted">{detail}</p>}
    </Card>
  );
}

function ArchiveModal({ open, onClose, productId, name }: { open: boolean; onClose: () => void; productId: string; name: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Archivar producto"
      description={name}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={pending || reason.trim().length < 3}
            onClick={() =>
              startTransition(async () => {
                const res = await archiveProductAction(productId, reason);
                if (res.ok) {
                  toast.success(res.message ?? "Archivado.");
                  onClose();
                  router.push("/inventario");
                } else setError(res.error);
              })
            }
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Archivar
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">El producto deja de aparecer en el inventario y en el asistente. No se borra ningún movimiento y se puede reactivar.</p>
        <Field label="Motivo" htmlFor="ar-r">
          <Input id="ar-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: ya no se usa" autoFocus />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function PresentationModal({ open, onClose, productId, unitPlural }: { open: boolean; onClose: () => void; productId: string; unitPlural: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [factor, setFactor] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar presentación"
      description="Definí la equivalencia exacta; el sistema nunca la supone."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !name.trim() || !factor}
            onClick={() =>
              startTransition(async () => {
                const res = await addPresentationAction(productId, name, factor);
                if (res.ok) {
                  toast.success(res.message ?? "Agregada.");
                  setName("");
                  setFactor("");
                  setError(null);
                  onClose();
                  router.refresh();
                } else setError(res.error);
              })
            }
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Agregar
          </Button>
        </div>
      }
    >
      <div className="flex items-end gap-2">
        <Field label="Presentación" htmlFor="pr-n" className="flex-1">
          <Input id="pr-n" value={name} onChange={(e) => setName(e.target.value)} placeholder="caja" autoFocus />
        </Field>
        <span className="pb-3 text-sm text-muted">=</span>
        <Field label={unitPlural} htmlFor="pr-f" className="w-32">
          <NumberInput id="pr-f" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="100" />
        </Field>
      </div>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </Modal>
  );
}
