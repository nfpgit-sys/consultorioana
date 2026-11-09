import {
  type Content,
  FinishReason,
  type FunctionDeclaration,
  FunctionCallingConfigMode,
  type GenerateContentParameters,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
} from "@google/genai";
import { toGeminiSchema } from "@/lib/ai/gemini-schema";
import type { Queryable } from "@/lib/db/types";
import { trackAiCall } from "@/lib/services/ai-usage";
import { closingReply, dateContext, executeTool, prefetchContext, SYSTEM_PROMPT, TOOL_SPECS, toolContextOf, type ToolInput } from "./tools";
import type { AssistantMessage, AssistantReply, Proposal } from "./types";

/** Herramientas en el formato de Gemini. Las que no tienen parámetros van sin esquema (Gemini lo exige). */
export const GEMINI_FUNCTIONS: FunctionDeclaration[] = TOOL_SPECS.map((t) => ({
  name: t.name,
  description: t.description,
  ...(Object.keys(t.parameters.properties).length ? { parameters: toGeminiSchema(t.parameters) } : {}),
}));

/** Cliente mínimo (permite inyectar uno falso en las pruebas). */
export interface GeminiClient {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}

export interface GeminiOptions {
  model: string;
  apiKey?: string;
  client?: GeminiClient;
  maxIterations?: number;
}

/** Motivos de corte que equivalen a una negativa (seguridad, contenido prohibido, etc.). */
const BLOCKED_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.LANGUAGE,
]);

const REFUSAL_REPLY = "No puedo ayudar con ese pedido. Puedo ayudarte con el inventario, las compras y los gastos del consultorio.";

export function createGeminiClient(apiKey: string): GeminiClient {
  return new GoogleGenAI({ apiKey });
}

function toContents(history: AssistantMessage[]): Content[] {
  const contents: Content[] = history
    .slice(-12)
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  while (contents.length && contents[0].role !== "user") contents.shift();
  return contents;
}

function parseToolContent(content: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { valor: value };
  } catch {
    return { texto: content };
  }
}

export async function runGeminiAssistant(q: Queryable, history: AssistantMessage[], opts: GeminiOptions): Promise<AssistantReply> {
  const client = opts.client ?? createGeminiClient(opts.apiKey ?? "");
  const contents = toContents(history);
  const proposals: Proposal[] = [];
  const prefetched = await prefetchContext(q, history);
  const systemInstruction = [SYSTEM_PROMPT, dateContext(), prefetched].filter(Boolean).join("\n\n");
  const tag = { provider: "gemini", model: opts.model, kind: "asistente" as const };
  let malformedRetries = 0;
  const toolCtx = toolContextOf(history);

  for (let i = 0; i < (opts.maxIterations ?? 8); i++) {
    const response = await trackAiCall(q, tag, () => client.models.generateContent({
      model: opts.model,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: GEMINI_FUNCTIONS }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        // El SDK no ejecuta nada por su cuenta: cada herramienta pasa por executeTool.
        automaticFunctionCalling: { disable: true },
        maxOutputTokens: 8192,
        // Sin reintentos ante 429: si se agotó el cupo gratuito, se responde enseguida con el modo básico.
        httpOptions: { timeout: 40_000, retryOptions: { attempts: 2, initialDelay: 1, maxDelay: 4, httpStatusCodes: [500, 502, 503, 504] } },
      },
    }));

    const candidate = response.candidates?.[0];
    if (!candidate) {
      // Sin candidatos: el pedido fue bloqueado por los filtros (promptFeedback.blockReason).
      return { reply: REFUSAL_REPLY, proposals, mode: "ia" };
    }
    const finish = candidate.finishReason ?? "";
    const parts: Part[] = candidate.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    const text = parts
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim();

    if (BLOCKED_REASONS.has(finish) && calls.length === 0) {
      return { reply: text || REFUSAL_REPLY, proposals, mode: "ia" };
    }
    if (finish === FinishReason.MALFORMED_FUNCTION_CALL && calls.length === 0) {
      // El modelo armó mal una llamada: se reintenta una vez; después se pide reformular.
      if (malformedRetries++ < 1) continue;
      return { reply: "No pude interpretar bien el pedido. Probá decirlo de otra forma o con menos operaciones a la vez.", proposals, mode: "ia" };
    }
    if (calls.length === 0) {
      if (finish === FinishReason.MAX_TOKENS && !text) {
        return { reply: "La respuesta quedó incompleta. Probá con un pedido más corto.", proposals, mode: "ia" };
      }
      return { reply: text || (proposals.length ? "Revisá la propuesta y confirmala para registrarla." : "Listo."), proposals, mode: "ia" };
    }

    // Se devuelve el contenido del modelo tal cual (incluye las firmas de pensamiento que Gemini exige).
    contents.push({ role: "model", parts });
    const responses: Part[] = [];
    let allProposalsOk = true;
    for (const part of calls) {
      const call = part.functionCall!;
      const name = call.name ?? "";
      let result: { content: string; isError: boolean };
      try {
        result = await executeTool(q, name, (call.args ?? {}) as ToolInput, proposals, toolCtx);
      } catch (err) {
        console.error("[asistente] error en herramienta", name, err);
        result = { content: JSON.stringify({ error: "Error interno al ejecutar la consulta." }), isError: true };
      }
      if (!name.startsWith("proponer_") || result.isError) allProposalsOk = false;
      const payload = parseToolContent(result.content);
      responses.push({
        functionResponse: { ...(call.id ? { id: call.id } : {}), name, response: result.isError ? { error: payload } : { output: payload } },
      });
    }
    // Si solo se prepararon tarjetas y todas salieron bien, el cierre lo redacta el servidor (una consulta menos).
    if (allProposalsOk && proposals.length > 0) return { reply: closingReply(proposals, text), proposals, mode: "ia" };
    contents.push({ role: "user", parts: responses });
  }
  return {
    reply: "No pude completar el pedido. Probá decirlo de otra forma o con menos operaciones a la vez.",
    proposals,
    mode: "ia",
  };
}
