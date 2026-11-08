import { normalizeName, tokenize } from "./normalize";

/**
 * Comparación difusa de nombres para:
 * - resolver a qué producto se refiere el usuario ("¿cuántos guantes quedan?")
 * - relacionar líneas de facturas con el catálogo ("JER DESC 5ML X100" -> "Jeringa descartable 5 ml")
 * - advertir antes de crear un producto casi duplicado.
 *
 * Reglas importantes: los números deben coincidir exactamente ("5 ml" no es "10 ml"),
 * y nunca se marca como seguro algo con alternativas cercanas.
 */

const SYNONYM_GROUPS: string[][] = [
  ["barbijo", "tapaboca", "mascarilla", "cubreboca"],
  ["anestesia", "anestesico"],
  ["cartucho", "carpule", "tubo anestesia"],
  ["eyector", "suctor", "succionador"],
  ["descartable", "desechable"],
  ["guante", "guant"],
];

const SYNONYMS = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) if (!word.includes(" ")) SYNONYMS.set(word, group[0]);
}

function canonicalTokens(value: string): string[] {
  return tokenize(value).map((t) => SYNONYMS.get(t) ?? t);
}

const isNumberToken = (t: string) => /^\d+(\.\d+)?$/.test(t);

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Similitud entre dos palabras: exacta, abreviatura (prefijo) o error de tipeo. */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (isNumberToken(a) || isNumberToken(b)) return 0;
  const min = Math.min(a.length, b.length);
  if (min >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  if (min >= 5 && levenshtein(a, b) <= 1) return 0.8;
  if (min >= 7 && levenshtein(a, b) <= 2) return 0.65;
  return 0;
}

export interface NameScore {
  /** Cuánto de lo que dijo el usuario (o la factura) aparece en el candidato. */
  coverageQuery: number;
  /** Cuánto del nombre del candidato aparece en lo que dijo el usuario (o la factura). */
  coverageCandidate: number;
  /** Medida simétrica. */
  dice: number;
  /**
   * Números del candidato frente a lo consultado:
   * - "conflicto": ambos tienen números y no coinciden (5 ml vs 10 ml)
   * - "faltante": el candidato tiene un número que la consulta no menciona
   */
  numeric: "ok" | "faltante" | "conflicto";
  headMatch: boolean;
  exact: boolean;
}

export function scoreNames(query: string, candidate: string): NameScore {
  const q = canonicalTokens(query);
  const c = canonicalTokens(candidate);
  const exact = normalizeName(query) === normalizeName(candidate) && q.length > 0;
  if (!q.length || !c.length) {
    return { coverageQuery: 0, coverageCandidate: 0, dice: 0, numeric: "ok", headMatch: false, exact: false };
  }
  const bestFor = (token: string, pool: string[]) => pool.reduce((best, other) => Math.max(best, tokenSimilarity(token, other)), 0);
  const qSum = q.reduce((acc, t) => acc + bestFor(t, c), 0);
  const cSum = c.reduce((acc, t) => acc + bestFor(t, q), 0);

  const qNums = new Set(q.filter(isNumberToken));
  const cNums = new Set(c.filter(isNumberToken));
  let numeric: NameScore["numeric"] = "ok";
  if (cNums.size > 0) {
    const missing = [...cNums].filter((n) => !qNums.has(n));
    if (missing.length > 0) numeric = qNums.size > 0 ? "conflicto" : "faltante";
  }

  return {
    coverageQuery: qSum / q.length,
    coverageCandidate: cSum / c.length,
    dice: (qSum + cSum) / (q.length + c.length),
    numeric,
    headMatch: tokenSimilarity(q[0], c[0]) >= 0.85,
    exact,
  };
}

export type MatchMode = "consulta" | "factura";

function numericFactor(s: NameScore, mode: MatchMode): number {
  if (s.numeric === "conflicto") return 0.35;
  // En una consulta ("¿cuántas jeringas quedan?") no mencionar el tamaño no es un error:
  // si hay varios tamaños, la resolución queda ambigua y se pregunta.
  if (s.numeric === "faltante") return mode === "factura" ? 0.85 : 1;
  return 1;
}

/** Puntaje 0..1 según el uso: consultas por chat o líneas de factura. */
export function matchScore(query: string, candidate: string, mode: MatchMode): number {
  const s = scoreNames(query, candidate);
  if (s.exact) return 1;
  let score: number;
  if (mode === "consulta") {
    score = 0.75 * s.coverageQuery + 0.25 * s.coverageCandidate;
  } else {
    score = 0.55 * s.coverageCandidate + 0.35 * s.dice + (s.headMatch ? 0.1 : 0);
  }
  return Math.min(1, score * numericFactor(s, mode));
}

export interface MatchCandidate {
  id: string;
  name: string;
  aliases?: string[];
}

export interface RankedCandidate<T extends MatchCandidate> {
  candidate: T;
  score: number;
  exact: boolean;
  via: "nombre" | "alias";
}

export function rankCandidates<T extends MatchCandidate>(
  query: string,
  candidates: T[],
  mode: MatchMode,
  limit = 5,
): RankedCandidate<T>[] {
  const normalizedQuery = normalizeName(query);
  const ranked: RankedCandidate<T>[] = [];
  for (const candidate of candidates) {
    const aliasExact = (candidate.aliases ?? []).some((a) => a === normalizedQuery || normalizeName(a) === normalizedQuery);
    if (aliasExact) {
      ranked.push({ candidate, score: 1, exact: true, via: "alias" });
      continue;
    }
    const nameScore = matchScore(query, candidate.name, mode);
    let best = nameScore;
    let via: "nombre" | "alias" = "nombre";
    for (const alias of candidate.aliases ?? []) {
      const s = matchScore(query, alias, mode) * 0.98;
      if (s > best) {
        best = s;
        via = "alias";
      }
    }
    ranked.push({ candidate, score: best, exact: nameScore === 1 && normalizeName(candidate.name) === normalizedQuery, via });
  }
  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name, "es"))
    .slice(0, limit);
}

export type QueryResolution<T extends MatchCandidate> =
  | { status: "resuelto"; match: T; score: number }
  | { status: "ambiguo"; options: T[] }
  | { status: "sin_coincidencia"; suggestions: T[] };

/** Resolución para consultas del chat: solo resuelve si hay un candidato claramente mejor. */
export function resolveProductQuery<T extends MatchCandidate>(query: string, candidates: T[]): QueryResolution<T> {
  const ranked = rankCandidates(query, candidates, "consulta", 8);
  if (ranked.length === 0) return { status: "sin_coincidencia", suggestions: [] };
  const exact = ranked.filter((r) => r.exact);
  if (exact.length === 1) return { status: "resuelto", match: exact[0].candidate, score: 1 };
  const strong = ranked.filter((r) => r.score >= 0.75);
  if (strong.length === 1) return { status: "resuelto", match: strong[0].candidate, score: strong[0].score };
  if (strong.length > 1) {
    const [first, second] = strong;
    if (first.score - second.score >= 0.2) return { status: "resuelto", match: first.candidate, score: first.score };
    return { status: "ambiguo", options: strong.slice(0, 5).map((r) => r.candidate) };
  }
  return {
    status: "sin_coincidencia",
    suggestions: ranked.filter((r) => r.score >= 0.4).slice(0, 3).map((r) => r.candidate),
  };
}

export type LineMatchStatus = "segura" | "dudosa" | "sin_coincidencia";

export interface LineMatch<T extends MatchCandidate> {
  status: LineMatchStatus;
  best?: RankedCandidate<T>;
  alternatives: RankedCandidate<T>[];
}

/**
 * Clasificación conservadora para líneas de factura. "segura" solo con alias aprendido,
 * nombre idéntico o un candidato muy alto sin competidores cercanos.
 */
export function classifyInvoiceLine<T extends MatchCandidate>(descriptions: string[], candidates: T[]): LineMatch<T> {
  const merged = new Map<string, RankedCandidate<T>>();
  for (const description of descriptions.filter(Boolean)) {
    for (const r of rankCandidates(description, candidates, "factura", 6)) {
      const prev = merged.get(r.candidate.id);
      if (!prev || r.score > prev.score) merged.set(r.candidate.id, r);
    }
  }
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  if (!best || best.score < 0.55) {
    return { status: "sin_coincidencia", best: undefined, alternatives: ranked.filter((r) => r.score >= 0.35).slice(0, 4) };
  }
  const margin = best.score - (second?.score ?? 0);
  const isSafe = (best.exact && (second?.score ?? 0) < 0.95) || (best.score >= 0.9 && margin >= 0.15);
  return {
    status: isSafe ? "segura" : "dudosa",
    best,
    alternatives: ranked.slice(1, 5),
  };
}

/** Productos existentes con nombre muy parecido (para advertir antes de crear un duplicado). */
export function findNearDuplicates<T extends MatchCandidate>(name: string, candidates: T[], threshold = 0.8): RankedCandidate<T>[] {
  return rankCandidates(name, candidates, "factura", 5).filter((r) => {
    const s = scoreNames(name, r.candidate.name);
    const factor = numericFactor(s, "factura");
    const low = Math.min(s.coverageQuery, s.coverageCandidate) * factor;
    const high = Math.max(s.coverageQuery, s.coverageCandidate) * factor;
    // Parecido en ambos sentidos, o un nombre contenido en el otro con pocas palabras de diferencia.
    return r.exact || low >= threshold || (high >= 0.99 && low >= 0.6);
  });
}
