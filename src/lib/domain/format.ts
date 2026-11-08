import { APP_CURRENCY, APP_LOCALE, APP_TIME_ZONE } from "@/lib/constants";
import { type BaseUnit, unitLabel } from "./units";

const currencyFormatter = new Intl.NumberFormat(APP_LOCALE, {
  style: "currency",
  currency: APP_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyCompact = new Intl.NumberFormat(APP_LOCALE, {
  style: "currency",
  currency: APP_CURRENCY,
  maximumFractionDigits: 0,
});

export function formatARS(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (opts.compact ? currencyCompact : currencyFormatter).format(value);
}

export function formatNumber(value: number | null | undefined, maxDecimals = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: maxDecimals }).format(value);
}

export function formatQuantity(value: number, unit: BaseUnit): string {
  return `${formatNumber(value)} ${unitLabel(unit, value)}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const longDateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: "UTC", month: "long", year: "numeric" });
const shortMonthFormatter = new Intl.DateTimeFormat(APP_LOCALE, { timeZone: "UTC", month: "short" });

/** Instante (ISO) mostrado en hora de Buenos Aires: "08/11/2026 14:32". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFormatter.format(new Date(iso)).replace(",", "");
}

/** Fecha calendario 'YYYY-MM-DD' (sin zona): "08/11/2026". */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  return dateFormatter.format(new Date(`${date}T00:00:00Z`));
}

export function formatLongDate(date: string): string {
  return longDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

export function formatMonth(yyyyMm: string): string {
  const text = monthFormatter.format(new Date(`${yyyyMm}-01T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatShortMonth(yyyyMm: string): string {
  return shortMonthFormatter.format(new Date(`${yyyyMm}-01T00:00:00Z`)).replace(".", "");
}

const isoDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha de hoy en Buenos Aires como 'YYYY-MM-DD'. */
export function todayAR(now: Date = new Date()): string {
  return isoDatePartsFormatter.format(now);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de `date` (semana argentina: lunes a domingo). */
export function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface DateRange {
  from: string;
  to: string;
  label: string;
}

export type PeriodPreset = "hoy" | "ayer" | "semana" | "mes" | "mes_anterior" | "ultimos_30" | "anio";

export function presetRange(preset: PeriodPreset, today: string = todayAR()): DateRange {
  switch (preset) {
    case "hoy":
      return { from: today, to: today, label: "hoy" };
    case "ayer": {
      const y = addDays(today, -1);
      return { from: y, to: y, label: "ayer" };
    }
    case "semana":
      return { from: startOfWeek(today), to: today, label: "esta semana" };
    case "mes":
      return { from: startOfMonth(today), to: today, label: "este mes" };
    case "mes_anterior": {
      const prev = addMonths(today, -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev), label: "el mes pasado" };
    }
    case "ultimos_30":
      return { from: addDays(today, -29), to: today, label: "los últimos 30 días" };
    case "anio":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "este año" };
  }
}
