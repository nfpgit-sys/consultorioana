"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Input, Select } from "@/components/ui/field";
import { MOVEMENT_KIND_LABELS, type MovementKind } from "@/lib/services/types";

export function MovementFilters({
  products,
  categories,
  values,
}: {
  products: { id: string; name: string; archived: boolean }[];
  categories: string[];
  values: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const update = (key: string, value: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...values, [key]: value })) if (v && k !== "pagina") sp.set(k, v);
    startTransition(() => router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false }));
  };
  return (
    <div className={`mb-4 grid grid-cols-2 gap-2 lg:grid-cols-6 ${pending ? "opacity-70" : ""}`}>
      <Select className="col-span-2" value={values.producto ?? ""} onChange={(e) => update("producto", e.target.value)} aria-label="Producto">
        <option value="">Todos los productos</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.archived ? " (archivado)" : ""}
          </option>
        ))}
      </Select>
      <Select value={values.tipo ?? ""} onChange={(e) => update("tipo", e.target.value)} aria-label="Tipo de movimiento">
        <option value="">Todos los tipos</option>
        {(Object.keys(MOVEMENT_KIND_LABELS) as MovementKind[]).map((k) => (
          <option key={k} value={k}>
            {MOVEMENT_KIND_LABELS[k]}
          </option>
        ))}
      </Select>
      <Select value={values.origen ?? ""} onChange={(e) => update("origen", e.target.value)} aria-label="Origen">
        <option value="">Todo origen</option>
        <option value="manual">Manual</option>
        <option value="texto">Asistente (texto)</option>
        <option value="voz">Asistente (voz)</option>
        <option value="factura">Factura</option>
      </Select>
      <Input type="date" value={values.desde ?? ""} onChange={(e) => update("desde", e.target.value)} aria-label="Desde" />
      <Input type="date" value={values.hasta ?? ""} onChange={(e) => update("hasta", e.target.value)} aria-label="Hasta" />
      {categories.length > 0 && (
        <Select className="col-span-2 lg:col-span-2" value={values.categoria ?? ""} onChange={(e) => update("categoria", e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
