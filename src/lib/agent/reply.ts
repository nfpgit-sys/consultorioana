/**
 * Limpieza de las respuestas del modelo antes de mostrarlas:
 * - la interfaz muestra texto plano: se quitan **negritas**, _cursivas_, `código` y # títulos,
 *   y las viñetas «*» o «-» pasan a «•»;
 * - si no se preparó ninguna tarjeta, se quitan las frases que mandan a «revisar la tarjeta».
 */
export function cleanAiReply(reply: string, hasProposals: boolean): string {
  let text = reply
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^(\s*)[*-]\s+/gm, "$1• ")
    .replace(/(^|[\s(«"])\*([^*\s][^*\n]*?)\*(?=$|[\s).,;:!?»"])/g, "$1$2");
  if (!hasProposals) {
    const kept = text
      .split("\n")
      .map((line) =>
        line
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => !/\btarjetas?\b/i.test(sentence))
          .join(" "),
      )
      .filter((line, i, all) => line.trim() !== "" || (i > 0 && all[i - 1].trim() !== ""));
    const joined = kept.join("\n").trim();
    if (joined) text = joined;
  }
  return text.trim();
}
