import { normalizeText, singularize } from "@/lib/domain/normalize";
import { parseDecimalAR, parseNumberWords } from "@/lib/domain/numbers";

/**
 * Números que la persona escribió (o dictó) en sus mensajes y que podrían ser la
 * equivalencia de una presentación ("cada caja trae 100", "caja x50", "cien", "50").
 *
 * Se descartan los que son la CANTIDAD de esa misma presentación ("usamos 2 cajas":
 * el 2 no dice cuántas unidades trae la caja) y los artículos "un/una/uno", que casi
 * siempre son cantidad y no equivalencia.
 *
 * Sirve para que el servidor rechace equivalencias que el modelo de IA haya supuesto.
 */
export function statedEquivalenceNumbers(texts: string[], presentationName: string): number[] {
  const presTokens = new Set(normalizeText(presentationName).split(" ").filter(Boolean).map(singularize));
  const found: number[] = [];
  for (const text of texts) {
    const tokens = normalizeText(text).split(" ").filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      let value: number | null = null;
      let consumed = 1;
      if (/^\d+(\.\d+)?$/.test(tokens[i])) {
        value = parseDecimalAR(tokens[i]);
      } else if (!["un", "una", "uno", "media", "medio"].includes(tokens[i]) || tokens[i + 1] === "docena") {
        const words = parseNumberWords(tokens.slice(i));
        if (words) {
          value = words.value;
          consumed = words.consumed;
        }
      }
      if (value === null || value <= 0) continue;
      const next = tokens[i + consumed];
      if (next && presTokens.has(singularize(next))) {
        i += consumed - 1;
        continue; // "2 cajas": es la cantidad, no la equivalencia.
      }
      found.push(value);
      i += consumed - 1;
    }
  }
  return found;
}

/** true si `factor` coincide con algún número que la persona dijo para esa presentación. */
export function isStatedEquivalence(texts: string[], presentationName: string, factor: number): boolean {
  return statedEquivalenceNumbers(texts, presentationName).some((n) => Math.abs(n - factor) < 1e-9);
}

/**
 * Cantidades de una presentación que dijo la persona ("agregá 2 cajas" -> [2]),
 * para detectar un stock inicial cargado en cajas en lugar de unidades base.
 */
export function statedPresentationQuantities(texts: string[], presentationName: string): number[] {
  const presTokens = new Set(normalizeText(presentationName).split(" ").filter(Boolean).map(singularize));
  const found: number[] = [];
  for (const text of texts) {
    const tokens = normalizeText(text).split(" ").filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      let value: number | null = null;
      let consumed = 1;
      if (/^\d+(\.\d+)?$/.test(tokens[i])) value = parseDecimalAR(tokens[i]);
      else {
        const words = parseNumberWords(tokens.slice(i));
        if (words) {
          value = words.value;
          consumed = words.consumed;
        }
      }
      if (value !== null && value > 0 && tokens[i + consumed] && presTokens.has(singularize(tokens[i + consumed]))) found.push(value);
      if (value !== null) i += consumed - 1;
    }
  }
  return found;
}

const AFFIRMATIVE = /^\s*(si|exacto|correcto|asi es|dale|ok|okay|eso|claro|tal cual|confirmo|afirmativo|perfecto)\b/;

/** ¿La respuesta de la persona es un «sí» (o equivalente)? */
export function isAffirmative(text: string): boolean {
  const t = normalizeText(text);
  return AFFIRMATIVE.test(t) && !/\bno\b/.test(t);
}

/**
 * Equivalencias que el asistente ofreció textualmente en su último mensaje para esa presentación
 * («¿o es 1 tubo = 1 unidad?», «cada caja trae 100»). Solo cuentan si la persona respondió que sí.
 */
export function offeredEquivalenceNumbers(assistantText: string, presentationName: string): number[] {
  const forms = normalizeText(presentationName)
    .split(" ")
    .filter(Boolean)
    .map((t) => `${singularize(t).replace(/[^a-z0-9]/g, "")}(?:s|es)?`)
    .join("\\s+");
  if (!forms) return [];
  const re = new RegExp(`\\b(?:1|un|una|cada)\\s+${forms}\\s+(?:equivale\\s+a\\s+|trae\\s+|tiene\\s+|son\\s+|contiene\\s+|viene\\s+con\\s+)?(\\d+(?:\\.\\d+)?)`, "g");
  return [...normalizeText(assistantText).matchAll(re)].map((m) => parseDecimalAR(m[1])).filter((n): n is number => n !== null && n > 0);
}
