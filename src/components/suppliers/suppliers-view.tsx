"use client";

import { Archive, Loader2, Pencil, Plus, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { archiveSupplierAction, createSupplierAction, updateSupplierAction } from "@/app/(app)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { formatARS } from "@/lib/domain/format";
import type { Supplier } from "@/lib/services/types";

function formatCuit(cuit: string | null): string {
  if (!cuit || cuit.length !== 11) return cuit ?? "";
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

export function SuppliersView({ suppliers, totals }: { suppliers: Supplier[]; totals: Record<string, number> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Supplier | "nuevo" | null>(null);
  const [form, setForm] = useState({ name: "", cuit: "", phone: "", email: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (editing && editing !== "nuevo") {
      setForm({ name: editing.name, cuit: formatCuit(editing.cuit), phone: editing.phone ?? "", email: editing.email ?? "", notes: editing.notes ?? "" });
    } else if (editing === "nuevo") setForm({ name: "", cuit: "", phone: "", email: "", notes: "" });
    setError(null);
  }, [editing]);

  const save = () =>
    startTransition(async () => {
      const values = { name: form.name, cuit: form.cuit || null, phone: form.phone || null, email: form.email || null, notes: form.notes || null };
      const res = editing === "nuevo" ? await createSupplierAction(values) : await updateSupplierAction((editing as Supplier).id, values);
      if (res.ok) {
        toast.success(res.message ?? "Guardado.");
        setEditing(null);
        router.refresh();
      } else setError(res.error);
    });

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing("nuevo")}>
          <Plus className="h-5 w-5" /> Nuevo proveedor
        </Button>
      </div>
      <Card>
        {suppliers.length === 0 ? (
          <EmptyState icon={<Truck className="h-6 w-6" />} title="Sin proveedores" description="Se crean solos al registrar compras o facturas, o podés agregarlos acá." />
        ) : (
          <ul className="divide-y divide-line">
            {suppliers.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="truncate text-sm text-muted">
                    {[s.cuit ? `CUIT ${formatCuit(s.cuit)}` : null, s.phone, s.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                  </p>
                </div>
                <div className="hidden text-right text-sm sm:block">
                  <p className="text-muted">Compras (12 meses)</p>
                  <p className="tabular font-medium">{formatARS(totals[s.id] ?? 0)}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Editar ${s.name}`} onClick={() => setEditing(s)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Archivar ${s.name}`}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      if (!window.confirm(`¿Archivar a ${s.name}? Sus compras se conservan.`)) return;
                      const res = await archiveSupplierAction(s.id);
                      if (res.ok) {
                        toast.success(res.message ?? "Archivado.");
                        router.refresh();
                      } else toast.error(res.error);
                    })
                  }
                >
                  <Archive className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "nuevo" ? "Nuevo proveedor" : "Editar proveedor"}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending || !form.name.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre o razón social" htmlFor="s-n">
            <Input id="s-n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="CUIT" htmlFor="s-c" optional>
              <Input id="s-c" value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} inputMode="numeric" placeholder="30-12345678-9" />
            </Field>
            <Field label="Teléfono" htmlFor="s-t" optional>
              <Input id="s-t" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
            </Field>
          </div>
          <Field label="Email" htmlFor="s-e" optional>
            <Input id="s-e" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Notas" htmlFor="s-no" optional>
            <Textarea id="s-no" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-16" />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>
    </>
  );
}
