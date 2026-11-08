"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/components/ui/cn";
import { Input, Select } from "@/components/ui/field";
import { type PeriodPreset, presetRange, todayAR } from "@/lib/domain/format";

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "semana", label: "Esta semana" },
  { value: "mes", label: "Este mes" },
  { value: "mes_anterior", label: "Mes pasado" },
  { value: "ultimos_30", label: "30 días" },
  { value: "anio", label: "Este año" },
];

/** Filtro de período (día, mes, personalizado) + filtros extra, todo en una fila sobre el contenido. */
export function PeriodFilter({
  from,
  to,
  extra = [],
}: {
  from: string;
  to: string;
  extra?: { key: string; label: string; value: string; options: { value: string; label: string }[] }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const today = todayAR();

  const push = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${sp}`, { scroll: false }));
  };

  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p.value, today);
    return r.from === from && r.to === to;
  })?.value;

  return (
    <div className={cn("mb-4 space-y-2", pending && "opacity-70")}>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => {
              const r = presetRange(p.value, today);
              push({ desde: r.from, hasta: r.to });
            }}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium",
              activePreset === p.value ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <label className="flex items-center gap-2 text-sm text-muted sm:w-auto">
          <span className="hidden sm:inline">Desde</span>
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && push({ desde: e.target.value })} aria-label="Desde" className="sm:w-44" />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted sm:w-auto">
          <span className="hidden sm:inline">Hasta</span>
          <Input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && push({ hasta: e.target.value })} aria-label="Hasta" className="sm:w-44" />
        </label>
        {extra.map((f) => (
          <Select key={f.key} value={f.value} onChange={(e) => push({ [f.key]: e.target.value || null })} aria-label={f.label} className="col-span-2 sm:col-span-1 sm:w-56">
            <option value="">{f.label}: todos</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ))}
      </div>
    </div>
  );
}
