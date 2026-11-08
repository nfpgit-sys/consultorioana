/**
 * Lectura de números escritos o dictados en formato argentino.
 * - "1.234,56" -> 1234.56   (punto de miles, coma decimal)
 * - "1.500"    -> 1500      (un punto seguido de 3 dígitos se interpreta como miles)
 * - "2,5"      -> 2.5
 * - "2.5"      -> 2.5
 * - "$ 12.000" -> 12000
 */
export function parseDecimalAR(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = input.trim().replace(/\$|ars|\s/gi, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;

  if (lastDot >= 0 && lastComma >= 0) {
    // El separador que aparece último es el decimal.
    if (lastComma > lastDot) normalized = s.replace(/\./g, "").replace(",", ".");
    else normalized = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const commas = s.split(",").length - 1;
    if (commas > 1) {
      if (!/^\d{1,3}(,\d{3})+$/.test(s)) return null;
      normalized = s.replace(/,/g, "");
    } else {
      normalized = s.replace(",", ".");
    }
  } else if (lastDot >= 0) {
    const dots = s.split(".").length - 1;
    if (dots > 1 || /^\d{1,3}\.\d{3}$/.test(s)) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
      normalized = s.replace(/\./g, "");
    } else {
      normalized = s;
    }
  } else {
    normalized = s;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const UNITS_WORDS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const TENS_WORDS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const HUNDREDS_WORDS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};

/**
 * Interpreta números escritos con palabras al inicio de una lista de tokens normalizados
 * (sin acentos). Devuelve el valor y cuántos tokens consumió. Soporta 0-999, "media" (0,5),
 * "docena" (12), "media docena" (6) y "un par de" (2).
 */
export function parseNumberWords(tokens: string[]): { value: number; consumed: number } | null {
  if (tokens.length === 0) return null;
  const [t0, t1, t2] = tokens;
  if ((t0 === "media" || t0 === "medio") && t1 === "docena") return { value: 6, consumed: 2 };
  if ((t0 === "una" || t0 === "un") && t1 === "docena") return { value: 12, consumed: 2 };
  if (t0 === "docena") return { value: 12, consumed: 1 };
  if (t0 === "un" && t1 === "par" && t2 === "de") return { value: 2, consumed: 2 };
  if (t0 === "medio" || t0 === "media") return { value: 0.5, consumed: 1 };

  let total = 0;
  let consumed = 0;
  let i = 0;
  if (HUNDREDS_WORDS[tokens[i]] !== undefined) {
    total += HUNDREDS_WORDS[tokens[i]];
    i += 1;
    consumed = i;
  }
  if (tokens[i] !== undefined && TENS_WORDS[tokens[i]] !== undefined) {
    total += TENS_WORDS[tokens[i]];
    i += 1;
    consumed = i;
    if (tokens[i] === "y" && tokens[i + 1] !== undefined && UNITS_WORDS[tokens[i + 1]] !== undefined && UNITS_WORDS[tokens[i + 1]] < 10) {
      total += UNITS_WORDS[tokens[i + 1]];
      i += 2;
      consumed = i;
    }
  } else if (tokens[i] !== undefined && UNITS_WORDS[tokens[i]] !== undefined) {
    total += UNITS_WORDS[tokens[i]];
    i += 1;
    consumed = i;
  }
  if (consumed === 0) return null;
  // "cien" solo vale 100; "ciento" exige continuación.
  if (tokens[0] === "ciento" && consumed === 1) return null;
  if (tokens[consumed] === "y" && (tokens[consumed + 1] === "medio" || tokens[consumed + 1] === "media")) {
    return { value: total + 0.5, consumed: consumed + 2 };
  }
  return { value: total, consumed };
}

/** Representación decimal exacta para pasar a SQL (evita notación científica). */
export function toDecimalString(value: number, decimals = 3): string {
  return value.toFixed(decimals);
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "bigint") return Number(value);
  return Number.NaN;
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}
