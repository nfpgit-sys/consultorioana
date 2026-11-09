"use client";

import { useMemo, useRef, useState } from "react";
import { formatARS, formatMonth, formatShortMonth } from "@/lib/domain/format";

export interface SpendingPoint {
  month: string;
  purchases: number;
  expenses: number;
}

/**
 * Columnas apiladas por mes: compras de materiales + gastos generales.
 * Paleta validada (scripts/validate_palette.js, superficie #ffffff): #0d9488 / #eb6834 — todos los controles PASS.
 * Especificación: columnas ≤ 24 px, extremo superior redondeado 4 px, base recta, separación de 2 px entre
 * segmentos, grilla de 1 px, tooltip por segmento (hover y foco), leyenda y vista de tabla.
 */
const SERIES = [
  { key: "purchases" as const, label: "Compras de materiales", color: "#0d9488" },
  { key: "expenses" as const, label: "Gastos generales", color: "#eb6834" },
];

const oneDecimal = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
/** Formato compacto en español: 250 mil, 1,2 M. */
const compact = {
  format(value: number): string {
    if (value >= 1_000_000) return `${oneDecimal.format(value / 1_000_000)} M`;
    if (value >= 1_000) return `${oneDecimal.format(value / 1_000)} mil`;
    return oneDecimal.format(value);
  },
};

function niceMax(value: number): number {
  if (value <= 0) return 1000;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function SpendingChart({ data, height = 220 }: { data: SpendingPoint[]; height?: number }) {
  const [hover, setHover] = useState<{ index: number; series: (typeof SERIES)[number]["key"]; x: number; y: number } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const width = 640;
  const margin = { top: 16, right: 8, bottom: 28, left: 56 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxTotal = Math.max(...data.map((d) => d.purchases + d.expenses), 0);
  const yMax = niceMax(maxTotal * 1.05);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  const band = innerW / Math.max(data.length, 1);
  const barW = Math.min(24, band * 0.5);
  const y = (v: number) => margin.top + innerH - (v / yMax) * innerH;
  const allZero = maxTotal === 0;

  const bars = useMemo(
    () =>
      data.map((d, i) => {
        const cx = margin.left + band * i + band / 2;
        const x = cx - barW / 2;
        const segments: { key: (typeof SERIES)[number]["key"]; y0: number; y1: number; value: number; top: boolean; first: boolean }[] = [];
        let acc = 0;
        const nonZero = SERIES.filter((s) => d[s.key] > 0);
        for (const s of SERIES) {
          const value = d[s.key];
          if (value <= 0) continue;
          const y0 = y(acc);
          acc += value;
          const y1 = y(acc);
          segments.push({ key: s.key, y0, y1, value, top: s.key === nonZero[nonZero.length - 1]?.key, first: segments.length === 0 });
        }
        return { d, i, cx, x, segments };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, band, barW, yMax],
  );

  const hovered = hover ? data[hover.index] : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div ref={wrapRef} className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          role="group"
          aria-label={`Evolución mensual de gastos de los últimos ${data.length} meses`}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke="#e8eef0" strokeWidth={1} />
              <text x={margin.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#5b6b70">
                {t === 0 ? "$ 0" : `$ ${compact.format(t)}`}
              </text>
            </g>
          ))}
          {bars.map(({ d, i, cx, x, segments }) => (
            <g key={d.month}>
              {segments.map((seg) => {
                // Separación de 2 px (color de superficie) entre segmentos apilados.
                const h = Math.max(seg.y0 - seg.y1 - (seg.first ? 0 : 2), 1);
                const r = seg.top ? Math.min(4, h) : 0;
                const top = seg.y1;
                const color = SERIES.find((s) => s.key === seg.key)!.color;
                const active = hover?.index === i && hover.series === seg.key;
                const path = r
                  ? `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${top + h} Z`
                  : `M${x},${top + h} L${x},${top} L${x + barW},${top} L${x + barW},${top + h} Z`;
                const show = (clientX: number, clientY: number) => {
                  const rect = wrapRef.current?.getBoundingClientRect();
                  setHover({ index: i, series: seg.key, x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) });
                };
                return (
                  <g key={seg.key}>
                    <path d={path} fill={color} opacity={hover && !active ? 0.55 : 1} />
                    {/* Área de interacción más grande que la marca */}
                    <rect
                      x={cx - band / 2 + 2}
                      y={top - 4}
                      width={band - 4}
                      height={h + 6}
                      fill="transparent"
                      tabIndex={0}
                      role="button"
                      aria-label={`${formatMonth(d.month)}: ${SERIES.find((s) => s.key === seg.key)!.label} ${formatARS(seg.value)}`}
                      onPointerMove={(e) => show(e.clientX, e.clientY)}
                      onFocus={() => {
                        const rect = wrapRef.current?.getBoundingClientRect();
                        const scale = (rect?.width ?? width) / width;
                        setHover({ index: i, series: seg.key, x: cx * scale, y: top * scale });
                      }}
                      onBlur={() => setHover(null)}
                      style={{ outline: "none", cursor: "default" }}
                    />
                  </g>
                );
              })}
              <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill="#5b6b70">
                {formatShortMonth(d.month)}
              </text>
            </g>
          ))}
          <line x1={margin.left} x2={width - margin.right} y1={y(0)} y2={y(0)} stroke="#cfd8db" strokeWidth={1} />
        </svg>
        {allZero && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
            Sin compras ni gastos registrados en estos meses.
          </p>
        )}
        {hover && hovered && (
          <div
            className="pointer-events-none absolute z-10 min-w-44 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-xl border border-line bg-white px-3 py-2 text-sm shadow-[var(--shadow-float)]"
            style={{ left: Math.min(Math.max(hover.x, 90), (wrapRef.current?.clientWidth ?? 300) - 90), top: hover.y }}
            role="tooltip"
          >
            <p className="mb-1 text-xs text-muted">{formatMonth(hovered.month)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                  {s.label}
                </span>
                <strong className="tabular text-ink">{formatARS(hovered[s.key])}</strong>
              </p>
            ))}
            <p className="mt-1 flex justify-between gap-3 border-t border-line pt-1">
              <span className="text-muted">Total</span>
              <strong className="tabular">{formatARS(hovered.purchases + hovered.expenses)}</strong>
            </p>
          </div>
        )}
      </div>
      <button type="button" onClick={() => setShowTable((s) => !s)} className="mt-2 inline-flex min-h-6 items-center text-sm font-medium text-brand-700 hover:underline">
        {showTable ? "Ocultar tabla" : "Ver como tabla"}
      </button>
      {showTable && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted uppercase">
                <th className="py-2 pr-3">Mes</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-2 pr-3 text-right">
                    {s.label}
                  </th>
                ))}
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month} className="border-b border-line/60">
                  <td className="py-1.5 pr-3">{formatMonth(d.month)}</td>
                  <td className="tabular py-1.5 pr-3 text-right">{formatARS(d.purchases)}</td>
                  <td className="tabular py-1.5 pr-3 text-right">{formatARS(d.expenses)}</td>
                  <td className="tabular py-1.5 text-right font-medium">{formatARS(d.purchases + d.expenses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
