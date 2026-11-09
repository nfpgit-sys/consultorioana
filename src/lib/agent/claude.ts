import Anthropic from "@anthropic-ai/sdk";
import type { Queryable } from "@/lib/db/types";
import { trackAiCall } from "@/lib/services/ai-usage";
import { closingReply, dateContext, executeTool, prefetchContext, SYSTEM_PROMPT, TOOL_SPECS, type ToolInput, userTextsOf } from "./tools";
import type { AssistantMessage, AssistantReply, Proposal } from "./types";

/** Herramientas en el formato de Claude (esquemas estrictos). */
export const TOOLS: Anthropic.Tool[] = TOOL_SPECS.map((t) => ({
  name: t.name,
  description: t.description,
  strict: true,
  input_schema: t.parameters as unknown as Anthropic.Tool.InputSchema,
}));

/** Cliente mínimo (permite inyectar uno falso en las pruebas). */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export interface ClaudeOptions {
  model: string;
  client?: MessagesClient;
  maxIterations?: number;
}

export async function runClaudeAssistant(q: Queryable, history: AssistantMessage[], opts: ClaudeOptions): Promise<AssistantReply> {
  const client: MessagesClient = opts.client ?? new Anthropic({ timeout: 45_000, maxRetries: 2 });
  const messages: Anthropic.MessageParam[] = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  const proposals: Proposal[] = [];
  const toolCtx = { userTexts: userTextsOf(history) };
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: dateContext() },
  ];
  const prefetched = await prefetchContext(q, history);
  if (prefetched) system.push({ type: "text", text: prefetched });
  const tag = { provider: "anthropic", model: opts.model, kind: "asistente" as const };

  for (let i = 0; i < (opts.maxIterations ?? 8); i++) {
    const response = await trackAiCall(q, tag, () => client.messages.create({
      model: opts.model,
      max_tokens: 8000,
      system,
      tools: TOOLS,
      messages,
      output_config: { effort: "medium" },
    }));

    if (response.stop_reason === "refusal") {
      return { reply: "No puedo ayudar con ese pedido. Puedo ayudarte con el inventario, las compras y los gastos del consultorio.", proposals, mode: "ia" };
    }
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      if (response.stop_reason === "max_tokens" && !text) {
        return { reply: "La respuesta quedó incompleta. Probá con un pedido más corto.", proposals, mode: "ia" };
      }
      return { reply: text || (proposals.length ? "Revisá la propuesta y confirmala para registrarla." : "Listo."), proposals, mode: "ia" };
    }

    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    const results: Anthropic.ToolResultBlockParam[] = [];
    let allProposalsOk = true;
    for (const use of toolUses) {
      let result: { content: string; isError: boolean };
      try {
        result = await executeTool(q, use.name, (use.input ?? {}) as ToolInput, proposals, toolCtx);
      } catch (err) {
        console.error("[asistente] error en herramienta", use.name, err);
        result = { content: JSON.stringify({ error: "Error interno al ejecutar la consulta." }), isError: true };
      }
      if (!use.name.startsWith("proponer_") || result.isError) allProposalsOk = false;
      results.push({ type: "tool_result", tool_use_id: use.id, content: result.content, is_error: result.isError });
    }
    // Si solo se prepararon tarjetas y todas salieron bien, el cierre lo redacta el servidor (una consulta menos).
    if (allProposalsOk && proposals.length > 0) return { reply: closingReply(proposals, text), proposals, mode: "ia" };
    messages.push({ role: "user", content: results });
  }
  return {
    reply: "No pude completar el pedido. Probá decirlo de otra forma o con menos operaciones a la vez.",
    proposals,
    mode: "ia",
  };
}
