import { formatNumber } from "./format";
import { BASE_UNITS, type BaseUnit, type PresentationLike, UNIT_DEFS, unitLabel } from "./units";

export interface UnitOption {
  value: string;
  label: string;
}

/** Unidades en las que se puede expresar una cantidad de este producto. */
export function unitOptionsFor(baseUnit: BaseUnit, presentations: PresentationLike[]): UnitOption[] {
  const def = UNIT_DEFS[baseUnit];
  const options: UnitOption[] = [{ value: "", label: `${def.plural} (unidad base)` }];
  for (const code of BASE_UNITS) {
    if (code !== baseUnit && UNIT_DEFS[code].dimension === def.dimension) {
      options.push({ value: code, label: UNIT_DEFS[code].plural });
    }
  }
  for (const p of presentations) {
    options.push({ value: p.name, label: `${p.name} (${formatNumber(p.factor)} ${unitLabel(baseUnit, p.factor)})` });
  }
  return options;
}

export const BASE_UNIT_OPTIONS: UnitOption[] = BASE_UNITS.map((code) => ({
  value: code,
  label:
    code === "unidad"
      ? "Unidades"
      : code === "par"
        ? "Pares"
        : `${UNIT_DEFS[code].plural.charAt(0).toUpperCase()}${UNIT_DEFS[code].plural.slice(1)} (${UNIT_DEFS[code].symbol})`,
}));

/** "250 unidades · 2,5 cajas" para mostrar el stock también en la presentación más grande. */
export function stockWithPresentations(quantity: number, baseUnit: BaseUnit, presentations: PresentationLike[]): string {
  const base = `${formatNumber(quantity)} ${unitLabel(baseUnit, quantity)}`;
  const biggest = [...presentations].sort((a, b) => b.factor - a.factor)[0];
  if (!biggest || biggest.factor <= 1 || quantity === 0) return base;
  const inPresentation = Math.round((quantity / biggest.factor) * 100) / 100;
  return `${base} · ${formatNumber(inPresentation, 2)} ${biggest.name}`;
}
