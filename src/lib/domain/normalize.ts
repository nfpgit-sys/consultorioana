/**
 * Normalización de textos para comparar nombres de productos, proveedores y presentaciones.
 * Objetivo: que "Jeringas descartables 5ml" y "jeringa descartable 5 ML" se reconozcan como
 * el mismo nombre, sin confundir "Jeringa 5 ml" con "Jeringa 10 ml".
 */

const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "para", "por", "y", "en", "a", "al", "e"]);

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Minúsculas, sin acentos, sin signos; separa números pegados a letras ("5ml" -> "5 ml"). */
export function normalizeText(value: string): string {
  return stripAccents(value.toLowerCase())
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(?<![0-9])\.|\.(?![0-9])/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Raíz aproximada en español para comparar singulares y plurales
 * ("jeringas" -> "jeringa", "algodones"/"algodón" -> "algodon", "papeles"/"papel" -> "papel").
 * No busca producir palabras reales sino una forma consistente: "descartable" y
 * "descartables" dan la misma raíz ("descartabl").
 */
export function singularize(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) return token;
  if (token.endsWith("ces")) return `${token.slice(0, -3)}z`;
  let t = token;
  if (t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 4 && t.endsWith("e") && "lnrdzj".includes(t[t.length - 2])) t = t.slice(0, -1);
  return t;
}

export function tokenize(value: string): string[] {
  const text = normalizeText(value);
  if (!text) return [];
  return text
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t))
    .map(singularize);
}

/** Clave canónica usada para impedir duplicados exactos (índice único en la base). */
export function normalizeName(value: string): string {
  return tokenize(value).join(" ");
}

/** Limpia espacios repetidos y recorta; conserva mayúsculas y acentos tal como los escribió la persona. */
export function cleanDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
