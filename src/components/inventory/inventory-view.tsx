"use client";

import { Archive, ChevronRight, Minus, PackageSearch, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { StockBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Input, Select } from "@/components/ui/field";
import { formatARS, formatQuantity } from "@/lib/domain/format";
import { stockWithPresentations } from "@/lib/domain/unit-options";
import type { Product, StockStatus } from "@/lib/services/types";
import { MovementModal } from "./movement-dialogs";
import { ProductFormModal } from "./product-form";

interface Props {
  products: Product[];
  categories: string[];
  usedCategories: string[];
  counts: { total: number; bajo: number; agotado: number };
  filters: { q: string; categoria: string; estado: StockStatus | "todos"; archived: boolean };
  openNew: boolean;
}

export function InventoryView({ products, categories, usedCategories, counts, filters, openNew }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.q);
  const [newOpen, setNewOpen] = useState(openNew);
  const [quick, setQuick] = useState<{ product: Product; kind: "consumo" | "ingreso" } | null>(null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("nuevo");
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== filters.q) setParam("q", search.trim() || null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const statusChips: { value: StockStatus | "todos"; label: string; count?: number }[] = [
    { value: "todos", label: "Todos", count: counts.total },
    { value: "bajo", label: "Stock bajo", count: counts.bajo },
    { value: "agotado", label: "Agotados", count: counts.agotado },
  ];

  return (
    <>
      <PageHeader
        title="Inventario"
        description={`${counts.total} productos activos`}
        actions={
          <Button onClick={() => setNewOpen(true)} aria-label="Agregar producto">
            <Plus className="h-5 w-5" /> Nuevo producto
          </Button>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, categoría o código"
              className="pl-11"
              aria-label="Buscar productos"
            />
          </div>
          <Select
            value={filters.categoria}
            onChange={(e) => setParam("categoria", e.target.value || null)}
            className="sm:w-56"
            aria-label="Filtrar por categoría"
          >
            <option value="">Todas las categorías</option>
            {usedCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {statusChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setParam("estado", chip.value === "todos" ? null : chip.value)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium",
                filters.estado === chip.value && !filters.archived
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-line bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {chip.label}
              {chip.count !== undefined && <span className="tabular opacity-80">{chip.count}</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setParam("archivados", filters.archived ? null : "1")}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium",
              filters.archived ? "border-slate-700 bg-slate-700 text-white" : "border-line bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            <Archive className="h-4 w-4" /> Archivados
          </button>
        </div>
      </div>

      <Card>
        {products.length === 0 ? (
          counts.total === 0 && !filters.archived ? (
            <EmptyState
              icon={<PackageSearch className="h-6 w-6" />}
              title="Todavía no hay productos"
              description="Agregá el primero con el botón «Nuevo producto» o pedíselo al asistente: «agregá 20 jeringas al inventario»."
              action={
                <Button onClick={() => setNewOpen(true)}>
                  <Plus className="h-5 w-5" /> Nuevo producto
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<PackageSearch className="h-6 w-6" />} title="No hay productos con esos filtros" />
          )
        ) : (
          <>
            {/* Celular: tarjetas */}
            <ul className="divide-y divide-line md:hidden">
              {products.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Link href={`/inventario/${p.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{p.name}</p>
                    <p className="truncate text-sm text-muted">
                      {stockWithPresentations(p.currentStock, p.baseUnit, p.presentations)}
                      {p.category ? ` · ${p.category}` : ""}
                    </p>
                    <div className="mt-1">
                      <StockBadge status={p.status} />
                    </div>
                  </Link>
                  {!p.archivedAt && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Registrar consumo de ${p.name}`}
                        onClick={() => setQuick({ product: p, kind: "consumo" })}
                        disabled={p.currentStock <= 0}
                      >
                        <Minus className="h-5 w-5" />
                      </Button>
                      <Button variant="secondary" size="icon" aria-label={`Registrar ingreso de ${p.name}`} onClick={() => setQuick({ product: p, kind: "ingreso" })}>
                        <Plus className="h-5 w-5" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* Computadora: tabla */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-medium tracking-wide text-muted uppercase">
                    <th className="px-5 py-3">Producto</th>
                    <th className="px-3 py-3">Stock</th>
                    <th className="px-3 py-3">Mínimo</th>
                    <th className="px-3 py-3">Estado</th>
                    <th className="px-3 py-3 text-right">Valor</th>
                    <th className="px-5 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3">
                        <Link href={`/inventario/${p.id}`} className="font-medium text-ink hover:text-brand-700">
                          {p.name}
                        </Link>
                        {p.category && <p className="text-xs text-muted">{p.category}</p>}
                      </td>
                      <td className="tabular px-3 py-3">{stockWithPresentations(p.currentStock, p.baseUnit, p.presentations)}</td>
                      <td className="tabular px-3 py-3 text-muted">{p.minStock > 0 ? formatQuantity(p.minStock, p.baseUnit) : "—"}</td>
                      <td className="px-3 py-3">
                        <StockBadge status={p.status} />
                      </td>
                      <td className="tabular px-3 py-3 text-right">{p.stockValue !== null ? formatARS(p.stockValue) : <span className="text-muted">Sin costo</span>}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1.5">
                          {!p.archivedAt && (
                            <>
                              <Button variant="outline" size="sm" onClick={() => setQuick({ product: p, kind: "consumo" })} disabled={p.currentStock <= 0}>
                                <Minus className="h-4 w-4" /> Consumo
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => setQuick({ product: p, kind: "ingreso" })}>
                                <Plus className="h-4 w-4" /> Ingreso
                              </Button>
                            </>
                          )}
                          <Link href={`/inventario/${p.id}`} className="inline-flex h-9 items-center rounded-xl px-2 text-muted hover:bg-black/5" aria-label={`Ver ${p.name}`}>
                            <ChevronRight className="h-5 w-5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <ProductFormModal open={newOpen} onClose={() => setNewOpen(false)} categories={categories} />
      {quick && <MovementModal open onClose={() => setQuick(null)} product={quick.product} kind={quick.kind} />}
    </>
  );
}
