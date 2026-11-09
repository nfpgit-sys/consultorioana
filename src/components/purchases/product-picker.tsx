"use client";

import { Check, ChevronsUpDown, PackagePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { normalizeText } from "@/lib/domain/normalize";

export interface PickerProduct {
  id: string;
  name: string;
  category: string | null;
}

/** Selector de producto con búsqueda (funciona bien con teclado y en pantallas táctiles). */
export function ProductPicker({
  products,
  value,
  onChange,
  placeholder = "Buscar producto…",
  allowNone = true,
  noneLabel = "Sin producto (gasto no inventariable)",
  onCreateNew,
  id,
  invalid,
}: {
  products: PickerProduct[];
  /** undefined = todavía no se eligió; null = línea sin producto (no inventariable). */
  value: string | null | undefined;
  onChange: (productId: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  onCreateNew?: (query: string) => void;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = products.find((p) => p.id === value) ?? null;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const terms = normalizeText(query).split(" ").filter(Boolean);
    const list = terms.length
      ? products.filter((p) => {
          const words = normalizeText(`${p.name} ${p.category ?? ""}`).split(" ");
          return terms.every((t) => words.some((w) => w.startsWith(t) || (t.length >= 4 && w.includes(t))));
        })
      : products;
    return list.slice(0, 50);
  }, [products, query]);

  const choose = (pid: string | null) => {
    onChange(pid);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3.5 text-left",
          invalid ? "border-amber-400 ring-2 ring-amber-200" : "border-line",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn("truncate", !selected && value !== null && "text-slate-500")}>
          {selected ? selected.name : value === null && allowNone ? noneLabel : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-64 overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-float)]">
          <div className="flex items-center border-b border-line px-3">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered[active]) choose(filtered[active].id);
                } else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Escribí para buscar"
              className="h-11 flex-1 bg-transparent outline-none"
              aria-label="Buscar producto"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda" className="p-1 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {allowNone && (
              <li>
                <button type="button" onClick={() => choose(null)} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm text-muted hover:bg-slate-50">
                  {value === null && <Check className="h-4 w-4" />} {noneLabel}
                </button>
              </li>
            )}
            {filtered.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  onClick={() => choose(p.id)}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm", i === active ? "bg-brand-50" : "hover:bg-slate-50")}
                >
                  {p.id === value ? <Check className="h-4 w-4 text-brand-700" /> : <span className="w-4" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    {p.category && <span className="block truncate text-xs text-muted">{p.category}</span>}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3.5 py-3 text-sm text-muted">No hay productos que coincidan.</li>}
          </ul>
          {onCreateNew && (
            <button
              type="button"
              onClick={() => {
                onCreateNew(query);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              <PackagePlus className="h-4 w-4" /> Crear producto nuevo{query ? `: «${query}»` : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
