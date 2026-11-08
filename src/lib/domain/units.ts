import { normalizeText, singularize } from "./normalize";

/**
 * Unidades base admitidas. El stock de cada producto se guarda siempre en su unidad base.
 * Solo se convierten automáticamente unidades físicas de la misma magnitud (g <-> kg, ml <-> l).
 * Las presentaciones comerciales (caja, tubo, frasco...) requieren una equivalencia definida
 * en el producto: nunca se supone cuántas unidades trae una caja.
 */
export const BASE_UNITS = ["unidad", "par", "g", "mg", "kg", "ml", "l", "cm", "m"] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export type Dimension = "conteo" | "pares" | "masa" | "volumen" | "longitud";

interface UnitDef {
  dimension: Dimension;
  /** Factor hacia la unidad canónica de la magnitud (g, ml, cm, unidad, par). */
  toCanonical: number;
  singular: string;
  plural: string;
  symbol: string;
  aliases: string[];
}

export const UNIT_DEFS: Record<BaseUnit, UnitDef> = {
  unidad: {
    dimension: "conteo",
    toCanonical: 1,
    singular: "unidad",
    plural: "unidades",
    symbol: "u",
    aliases: ["unidad", "unidades", "u", "uni", "unid", "ud", "uds", "unds", "unidade"],
  },
  par: { dimension: "pares", toCanonical: 1, singular: "par", plural: "pares", symbol: "par", aliases: ["par", "pares"] },
  mg: {
    dimension: "masa",
    toCanonical: 0.001,
    singular: "miligramo",
    plural: "miligramos",
    symbol: "mg",
    aliases: ["mg", "miligramo", "miligramos"],
  },
  g: {
    dimension: "masa",
    toCanonical: 1,
    singular: "gramo",
    plural: "gramos",
    symbol: "g",
    aliases: ["g", "gr", "grs", "gramo", "gramos"],
  },
  kg: {
    dimension: "masa",
    toCanonical: 1000,
    singular: "kilo",
    plural: "kilos",
    symbol: "kg",
    aliases: ["kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos"],
  },
  ml: {
    dimension: "volumen",
    toCanonical: 1,
    singular: "mililitro",
    plural: "mililitros",
    symbol: "ml",
    aliases: ["ml", "mililitro", "mililitros", "cc", "cm3"],
  },
  l: {
    dimension: "volumen",
    toCanonical: 1000,
    singular: "litro",
    plural: "litros",
    symbol: "l",
    aliases: ["l", "lt", "lts", "litro", "litros"],
  },
  cm: {
    dimension: "longitud",
    toCanonical: 1,
    singular: "centímetro",
    plural: "centímetros",
    symbol: "cm",
    aliases: ["cm", "centimetro", "centimetros"],
  },
  m: {
    dimension: "longitud",
    toCanonical: 100,
    singular: "metro",
    plural: "metros",
    symbol: "m",
    aliases: ["m", "mt", "mts", "metro", "metros"],
  },
};

const ALIAS_TO_UNIT = new Map<string, BaseUnit>();
for (const code of BASE_UNITS) {
  for (const alias of UNIT_DEFS[code].aliases) ALIAS_TO_UNIT.set(alias, code);
}

export function isBaseUnit(value: string): value is BaseUnit {
  return (BASE_UNITS as readonly string[]).includes(value);
}

/** Reconoce una unidad física por cualquiera de sus nombres ("gramos", "grs", "cc"...). */
export function resolvePhysicalUnit(input: string): BaseUnit | null {
  const key = normalizeText(input).replace(/\s+/g, "");
  if (!key) return null;
  return ALIAS_TO_UNIT.get(key) ?? null;
}

/** Redondeo a 3 decimales (precisión de las cantidades en la base). */
export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function convertPhysical(quantity: number, from: BaseUnit, to: BaseUnit): number | null {
  const a = UNIT_DEFS[from];
  const b = UNIT_DEFS[to];
  if (a.dimension !== b.dimension) return null;
  return round3((quantity * a.toCanonical) / b.toCanonical);
}

export function unitLabel(unit: BaseUnit, quantity = 2): string {
  const def = UNIT_DEFS[unit];
  if (["g", "mg", "kg", "ml", "l", "cm", "m"].includes(unit)) return def.symbol;
  return Math.abs(quantity) === 1 ? def.singular : def.plural;
}

export function unitDisplayName(unit: BaseUnit): string {
  const def = UNIT_DEFS[unit];
  return def.symbol === def.singular ? def.singular : `${def.plural} (${def.symbol})`;
}

export interface PresentationLike {
  id?: string;
  name: string;
  factor: number;
}

export interface ProductUnitInfo {
  name: string;
  baseUnit: BaseUnit;
  presentations: PresentationLike[];
}

export type ConversionResult =
  | {
      ok: true;
      baseQuantity: number;
      kind: "base" | "fisica" | "presentacion";
      unitLabel: string;
      presentation?: PresentationLike;
    }
  | {
      ok: false;
      code: "cantidad_invalida" | "unidad_desconocida" | "unidad_incompatible" | "cantidad_muy_chica";
      error: string;
    };

export function normalizePresentationName(name: string): string {
  return normalizeText(name)
    .split(" ")
    .filter(Boolean)
    .map(singularize)
    .join(" ");
}

export function findPresentation(product: ProductUnitInfo, unitInput: string): PresentationLike | undefined {
  const key = normalizePresentationName(unitInput);
  if (!key) return undefined;
  return product.presentations.find((p) => normalizePresentationName(p.name) === key);
}

/**
 * Convierte una cantidad expresada en cualquier unidad a la unidad base del producto.
 * Nunca inventa equivalencias: si la unidad no es física compatible ni una presentación
 * definida, devuelve un error explicativo.
 */
export function toBaseQuantity(product: ProductUnitInfo, quantity: number, unitInput?: string | null): ConversionResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, code: "cantidad_invalida", error: "La cantidad tiene que ser un número mayor que cero." };
  }
  const base = product.baseUnit;
  const raw = (unitInput ?? "").trim();

  const finish = (value: number, kind: "base" | "fisica" | "presentacion", label: string, presentation?: PresentationLike): ConversionResult => {
    const rounded = round3(value);
    if (rounded <= 0) {
      return {
        ok: false,
        code: "cantidad_muy_chica",
        error: `La cantidad es demasiado chica para registrarse en ${unitLabel(base)} (se redondea a 0).`,
      };
    }
    return { ok: true, baseQuantity: rounded, kind, unitLabel: label, presentation };
  };

  if (!raw) return finish(quantity, "base", unitLabel(base, quantity));

  // Primero, presentaciones del producto (pueden llamarse igual que una unidad, p. ej. "par").
  const presentation = findPresentation(product, raw);
  if (presentation) return finish(quantity * presentation.factor, "presentacion", presentation.name, presentation);

  const physical = resolvePhysicalUnit(raw);
  if (physical) {
    if (physical === base) return finish(quantity, "base", unitLabel(base, quantity));
    const converted = convertPhysical(quantity, physical, base);
    if (converted === null) {
      return {
        ok: false,
        code: "unidad_incompatible",
        error: `"${product.name}" se mide en ${UNIT_DEFS[base].plural}; no se puede convertir desde ${UNIT_DEFS[physical].plural} sin una equivalencia definida.`,
      };
    }
    return finish(converted, "fisica", unitLabel(physical, quantity));
  }

  return {
    ok: false,
    code: "unidad_desconocida",
    error: `La unidad "${raw}" no está definida para "${product.name}". Definí primero cuántas ${UNIT_DEFS[base].plural} trae (por ejemplo: 1 ${raw} = 100 ${UNIT_DEFS[base].plural}).`,
  };
}

/** Sugerencias de nombres de presentación frecuentes en un consultorio. */
export const COMMON_PRESENTATIONS = [
  "caja",
  "paquete",
  "tubo",
  "frasco",
  "jeringa",
  "cartucho",
  "sobre",
  "rollo",
  "blíster",
  "bolsa",
  "kit",
  "pote",
  "bidón",
  "ampolla",
  "pack",
];
