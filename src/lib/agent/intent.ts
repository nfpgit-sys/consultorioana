import { normalizeText } from "@/lib/domain/normalize";

/**
 * Expresiones con las que la persona indica que algo SE USÓ (consumo) o que ENTRÓ (ingreso).
 * El servidor no acepta una tarjeta de consumo o ingreso si la persona no dijo cuál de las dos fue:
 * ante «jeringas 5» el asistente tiene que preguntar en lugar de suponer.
 */
const CONSUMO_RE =
  /\b(gast\w*|us(e|o|a|amos|aron|ar|ado|ada|ados|adas|aste)|utiliz\w*|consum\w*|ocup(e|o|amos|aron|ar|ado|ados)|saq\w*|sac(o|amos|aron|ar|ame|a)|descont\w*|rest(a|ar|ale|ame|amos|aron)|baj(a|ar|ame|ale)|tir(e|o|amos|aron|ar)|descart(e|o|amos|aron|ar)|romp\w*|rot[oa]s?|perd\w*|aplic\w*|egreso|salida|salieron|salio|se (nos |me )?(fue|fueron|acabo|acabaron|termino|terminaron|venci\w*))\b/;

const INGRESO_RE =
  /\b(agreg\w*|sum(a|ar|ale|ame|amos|aron|o|e)|ingres\w*|carg(a|ar|ame|ale|amos|aron|o|ue)|entr(o|aron|ada|adas|ar)|lleg\w*|recib\w*|anot\w*|regal\w*|don(o|aron|aron|acion)|repus\w*|repon\w*|devol\w*|devuel\w*|compr\w*|adquir\w*)\b/;

export type MovementKind = "consumo" | "ingreso";

/** ¿La persona dijo, en estos mensajes, que fue un consumo o un ingreso? */
export function statedMovementKinds(texts: string[]): Set<MovementKind> {
  const kinds = new Set<MovementKind>();
  for (const text of texts) {
    const t = normalizeText(text);
    if (CONSUMO_RE.test(t)) kinds.add("consumo");
    if (INGRESO_RE.test(t)) kinds.add("ingreso");
  }
  return kinds;
}
