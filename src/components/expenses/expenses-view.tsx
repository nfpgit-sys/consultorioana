"use client";

import { Ban, Loader2, Plus, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { voidExpenseAction } from "@/app/(app)/actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { formatARS, formatDate } from "@/lib/domain/format";
import type { Expense } from "@/lib/services/expenses";
import type { Supplier } from "@/lib/services/types";
import { ExpenseFormModal } from "./expense-form";

export function ExpensesView({
  expenses,
  categories,
  suppliers,
  openNew,
}: {
  expenses: Expense[];
  categories: string[];
  suppliers: Supplier[];
  openNew: boolean;
}) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(openNew);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = expenses.filter((e) => e.status === "registrado");
  const total = active.reduce((a, e) => a + e.amount, 0);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="h-5 w-5" /> Nuevo gasto
        </Button>
      </div>
      <Card>
        {expenses.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="No hay gastos en este período"
            description="Registrá alquiler, servicios, laboratorio y otros gastos que no suman stock."
            action={
              <Button onClick={() => setNewOpen(true)}>
                <Plus className="h-5 w-5" /> Nuevo gasto
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex justify-between border-b border-line px-4 py-3 text-sm sm:px-5">
              <span className="text-muted">{active.length} gastos</span>
              <span className="tabular font-semibold">{formatARS(total)}</span>
            </div>
            <ul className="divide-y divide-line">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.description}</p>
                    <p className="truncate text-sm text-muted">
                      {formatDate(e.expenseDate)} · {e.category}
                      {e.supplierName ? ` · ${e.supplierName}` : ""} · #{e.number}
                      {e.source !== "manual" ? ` · ${e.source === "factura" ? "desde factura" : "asistente"}` : ""}
                    </p>
                    {e.status === "anulado" && <p className="text-xs text-muted">Anulado: {e.voidReason}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`tabular font-semibold ${e.status === "anulado" ? "text-slate-400 line-through" : ""}`}>{formatARS(e.amount)}</p>
                    {e.status === "anulado" ? (
                      <Badge>Anulado</Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setVoiding(e);
                          setReason("");
                          setError(null);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-700"
                      >
                        <Ban className="h-3.5 w-3.5" /> Anular
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <ExpenseFormModal open={newOpen} onClose={() => setNewOpen(false)} categories={categories} suppliers={suppliers} />
      <Modal
        open={voiding !== null}
        onClose={() => setVoiding(null)}
        title={`Anular gasto #${voiding?.number ?? ""}`}
        description={voiding ? `${voiding.description} · ${formatARS(voiding.amount)}` : undefined}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                startTransition(async () => {
                  const res = await voidExpenseAction(voiding!.id, reason);
                  if (res.ok) {
                    toast.success(res.message ?? "Anulado.");
                    setVoiding(null);
                    router.refresh();
                  } else setError(res.error);
                })
              }
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Anular
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">El gasto queda en el historial marcado como anulado y deja de sumar en los reportes.</p>
          <Field label="Motivo" htmlFor="ga-r">
            <Input id="ga-r" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>
    </>
  );
}
