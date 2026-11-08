import Anthropic from "@anthropic-ai/sdk";
import type { Queryable } from "@/lib/db/types";
import { getAiConfig } from "@/lib/config";
import { runClaudeAssistant } from "./claude";
import { runLocalAssistant } from "./local";
import type { AssistantMessage, AssistantReply } from "./types";

export type { AssistantMessage, AssistantReply, Proposal } from "./types";

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "la clave de IA no es válida";
  if (err instanceof Anthropic.PermissionDeniedError) return "la clave de IA no tiene permisos para este modelo";
  if (err instanceof Anthropic.RateLimitError) return "se alcanzó el límite de uso de la IA";
  if (err instanceof Anthropic.APIConnectionError) return "no hubo conexión con el servicio de IA";
  if (err instanceof Anthropic.BadRequestError) return "el servicio de IA rechazó el pedido";
  if (err instanceof Anthropic.APIError) return `el servicio de IA respondió con error ${err.status ?? ""}`.trim();
  return "ocurrió un error inesperado con la IA";
}

/**
 * Punto de entrada del asistente: usa Claude si está configurado; si no, o si la IA falla,
 * responde con el intérprete local (modo básico). En ningún caso se registra nada sin confirmación.
 */
export async function runAssistant(q: Queryable, history: AssistantMessage[]): Promise<AssistantReply> {
  const last = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const ai = getAiConfig();
  if (!ai.enabled) return runLocalAssistant(q, last);
  try {
    return await runClaudeAssistant(q, history, { model: ai.assistantModel });
  } catch (err) {
    console.error("[asistente] fallo de IA:", err);
    const local = await runLocalAssistant(q, last);
    return { ...local, notice: `No se pudo usar la IA (${describeApiError(err)}). Respondí con el modo básico.` };
  }
}
