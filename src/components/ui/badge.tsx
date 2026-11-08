import type { ReactNode } from "react";
import type { StockStatus } from "@/lib/services/types";
import { cn } from "./cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-800 ring-rose-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

const STOCK_LABEL: Record<StockStatus, string> = { ok: "Suficiente", bajo: "Stock bajo", agotado: "Agotado" };
const STOCK_TONE: Record<StockStatus, Tone> = { ok: "success", bajo: "warning", agotado: "danger" };

export function StockBadge({ status }: { status: StockStatus }) {
  return (
    <Badge tone={STOCK_TONE[status]}>
      <span
        className={cn("h-1.5 w-1.5 rounded-full", status === "ok" ? "bg-emerald-500" : status === "bajo" ? "bg-amber-500" : "bg-rose-500")}
        aria-hidden
      />
      {STOCK_LABEL[status]}
    </Badge>
  );
}
