import { describeAiError } from "@/lib/ai/errors";
import type { Queryable } from "@/lib/db/types";
import { getAiConfig } from "@/lib/config";
import { runClaudeAssistant } from "./claude";
import { type GeminiClient, runGeminiAssistant } from "./gemini";
import { runLocalAssistant } from "./local";
import type { AssistantMessage, AssistantReply } from "./types";

export type { AssistantMessage, AssistantReply, Proposal } from "./types";

/**
 * Punto de entrada del asistente: usa la IA configurada (Gemini o Claude); si no hay IA,
 * o si falla (por ejemplo, se agotó el cupo gratuito), responde con el intérprete local
 * (modo básico). En ningún caso se registra nada sin confirmación.
 */
export async function runAssistant(
  q: Queryable,
  history: AssistantMessage[],
  deps: { geminiClient?: GeminiClient } = {},
): Promise<AssistantReply> {
  const last = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const ai = getAiConfig();
  if (!ai.enabled) return runLocalAssistant(q, last);
  try {
    if (ai.provider === "gemini") {
      return await runGeminiAssistant(q, history, { model: ai.assistantModel, apiKey: process.env[ai.keyVar]?.trim(), client: deps.geminiClient });
    }
    return await runClaudeAssistant(q, history, { model: ai.assistantModel });
  } catch (err) {
    const info = describeAiError(err);
    console.error(`[asistente] fallo de IA (${info.kind}):`, err);
    const local = await runLocalAssistant(q, last);
    return { ...local, notice: `No se pudo usar la IA (${info.message}). Respondí con el modo básico.` };
  }
}
