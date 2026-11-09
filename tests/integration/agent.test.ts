import type Anthropic from "@anthropic-ai/sdk";
import { ApiError, type Content, FinishReason, type GenerateContentParameters, GenerateContentResponse, type Part } from "@google/genai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runAssistant } from "@/lib/agent";
import { runClaudeAssistant, type MessagesClient } from "@/lib/agent/claude";
import { type GeminiClient, runGeminiAssistant } from "@/lib/agent/gemini";
import { parseItems, parsePeriod, runLocalAssistant } from "@/lib/agent/local";
import type { Database } from "@/lib/db/types";
import { createExpense } from "@/lib/services/expenses";
import { addPresentation, createProduct, getProduct } from "@/lib/services/products";
import { todayAR } from "@/lib/domain/format";
import { createTestDb, manual } from "../helpers/db";

let db: Database;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  const mk = async (key: string, name: string, extra: Record<string, unknown> = {}) => {
    ids[key] = (await createProduct(db, { name, baseUnit: "unidad", ...extra }, manual)).result.productId;
  };
  await mk("jeringa", "Jeringa descartable 5 ml", { initialStock: 5, minStock: 2, unitCost: 100 });
  await mk("guantesM", "Guantes de látex talle M", { initialStock: 300, minStock: 100 });
  await mk("guantesS", "Guantes de nitrilo talle S", { initialStock: 50, minStock: 100 });
  await mk("pasta", "Pasta profiláctica", { initialStock: 1, minStock: 2 });
  await mk("alginato", "Alginato", { baseUnit: "g", initialStock: 900 });
  await addPresentation(db, ids.guantesM, { name: "caja", factor: 100 }, manual);
  await addPresentation(db, ids.pasta, { name: "tubo", factor: 1 }, manual);
  await createExpense(db, { expenseDate: todayAR(), category: "Alquiler", description: "Alquiler del mes", amount: 300000 }, manual);
});

afterAll(async () => {
  await db?.close();
});

describe("intérprete local (modo básico)", () => {
  it("«Hoy gasté 3 jeringas» propone un consumo 5 → 2 sin registrarlo", async () => {
    const r = await runLocalAssistant(db, "Hoy gasté 3 jeringas");
    expect(r.proposals).toHaveLength(1);
    const p = r.proposals[0];
    expect(p.type).toBe("movimientos");
    if (p.type === "movimientos") {
      expect(p.lines[0]).toMatchObject({ productId: ids.jeringa, kind: "consumo", baseQuantity: 3, stockBefore: 5, stockAfter: 2 });
    }
    expect((await getProduct(db, ids.jeringa))?.currentStock).toBe(5);
  });

  it("«¿Cuántos guantes quedan?» lista las opciones con su stock", async () => {
    const r = await runLocalAssistant(db, "¿Cuántos guantes quedan?");
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("Guantes de látex talle M");
    expect(r.reply).toContain("Guantes de nitrilo talle S");
    expect(r.reply).toContain("300 unidades");
  });

  it("responde el stock de un producto específico", async () => {
    const r = await runLocalAssistant(db, "cuantos guantes de nitrilo quedan");
    expect(r.reply).toContain("quedan 50 unidades");
    expect(r.reply).toContain("stock bajo");
  });

  it("«¿Qué productos están por agotarse?» lista bajos y agotados", async () => {
    const r = await runLocalAssistant(db, "¿Qué productos están por agotarse?");
    expect(r.reply).toContain("Guantes de nitrilo talle S");
    expect(r.reply).toContain("Pasta profiláctica");
    expect(r.reply).not.toContain("Alginato");
  });

  it("«Mostrame cuánto gastamos este mes» suma compras y gastos", async () => {
    const r = await runLocalAssistant(db, "Mostrame cuánto gastamos este mes");
    expect(r.proposals).toHaveLength(0);
    expect(r.reply.replace(/\s/g, " ")).toContain("$ 300.000,00");
    expect(r.reply).toContain("Alquiler");
  });

  it("convierte presentaciones definidas: «usamos 2 cajas de guantes de látex»", async () => {
    const r = await runLocalAssistant(db, "usamos 2 cajas de guantes de latex");
    const p = r.proposals[0];
    expect(p?.type).toBe("movimientos");
    if (p?.type === "movimientos") expect(p.lines[0]).toMatchObject({ productId: ids.guantesM, baseQuantity: 200, stockAfter: 100 });
  });

  it("varias líneas en una frase", async () => {
    const r = await runLocalAssistant(db, "gasté 1 jeringa y 2 guantes de nitrilo");
    const p = r.proposals[0];
    expect(p?.type === "movimientos" && p.lines.map((l) => l.productId)).toEqual([ids.jeringa, ids.guantesS]);
  });

  it("no inventa equivalencias: pide definir la presentación", async () => {
    const r = await runLocalAssistant(db, "gasté 2 cajas de guantes de nitrilo");
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("caja");
    expect(r.reply).toContain("no está definida");
  });

  it("no deja stock negativo: explica el problema", async () => {
    const r = await runLocalAssistant(db, "gasté 30 jeringas");
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("No hay stock suficiente");
  });

  it("«Compramos 5 tubos de pasta profiláctica» queda pendiente de precio", async () => {
    const r = await runLocalAssistant(db, "Compramos 5 tubos de pasta profiláctica");
    const p = r.proposals[0];
    expect(p?.type).toBe("compra");
    if (p?.type === "compra") {
      expect(p.pendingPrice).toBe(true);
      expect(p.lines[0].stockAfter).toBe(6);
    }
  });

  it("detecta el precio de una compra", async () => {
    const r = await runLocalAssistant(db, "compramos 2 tubos de pasta profilactica por $12.000");
    const p = r.proposals[0];
    expect(p?.type === "compra" && p.total).toBe(12000);
  });

  it("«Agregá 20 jeringas al inventario» suma si existe y propone crear si no existe", async () => {
    const existing = await runLocalAssistant(db, "Agregá 20 jeringas al inventario");
    expect(existing.proposals[0]?.type).toBe("movimientos");
    const missing = await runLocalAssistant(db, "Agregá 20 baberos al inventario");
    const p = missing.proposals[0];
    expect(p?.type).toBe("producto");
    if (p?.type === "producto") expect(p.input).toMatchObject({ name: "Baberos", baseUnit: "unidad", initialStock: 20 });
  });

  it("registra gastos generales simples", async () => {
    const r = await runLocalAssistant(db, "pagamos la luz $45.000");
    const p = r.proposals[0];
    expect(p?.type).toBe("gasto");
    if (p?.type === "gasto") expect(p.input).toMatchObject({ category: "Luz", amount: 45000 });
  });

  it("no inventa productos inexistentes", async () => {
    const r = await runLocalAssistant(db, "gasté 3 brackets");
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("No encontré");
  });

  it("parsea cantidades y períodos", () => {
    expect(parseItems("3 jeringas y dos pares de guantes")).toMatchObject([
      { quantity: 3, unitWord: null, productPhrase: "jeringas" },
      { quantity: 2, unitWord: "pares", productPhrase: "guantes" },
    ]);
    expect(parsePeriod("cuanto gastamos el mes pasado", "2026-03-15")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(parsePeriod("gastos de diciembre", "2026-03-15")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });
});

/** Cliente falso que simula al modelo: busca el producto y después propone el consumo. */
function scriptedClient(steps: ((messages: Anthropic.MessageParam[]) => Anthropic.ContentBlock[])[]): MessagesClient & { calls: number } {
  const client = {
    calls: 0,
    messages: {
      async create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
        const step = steps[client.calls] ?? steps[steps.length - 1];
        client.calls += 1;
        const content = step(params.messages as Anthropic.MessageParam[]);
        const hasTool = content.some((b) => b.type === "tool_use");
        return {
          id: `msg_${client.calls}`,
          type: "message",
          role: "assistant",
          model: params.model,
          content,
          stop_reason: hasTool ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return client;
}

function lastToolResult(messages: Anthropic.MessageParam[]): { content: string; is_error?: boolean } {
  const last = messages[messages.length - 1];
  const blocks = last.content as Anthropic.ToolResultBlockParam[];
  return { content: String(blocks[0].content), is_error: blocks[0].is_error };
}

describe("agente con Claude (cliente simulado)", () => {
  it("busca el producto, propone el consumo y no registra nada", async () => {
    const client = scriptedClient([
      () => [{ type: "tool_use", id: "t1", name: "buscar_productos", input: { texto: "jeringas" }, caller: null } as unknown as Anthropic.ContentBlock],
      (messages) => {
        const result = JSON.parse(lastToolResult(messages).content);
        const id = result.coincidencias[0].producto_id;
        return [
          {
            type: "tool_use",
            id: "t2",
            name: "proponer_movimientos",
            input: { movimientos: [{ producto_id: id, cantidad: 3, unidad: null, tipo: "consumo", motivo: null }], fecha: null },
          } as unknown as Anthropic.ContentBlock,
        ];
      },
      (messages) => {
        const result = JSON.parse(lastToolResult(messages).content);
        expect(result.estado).toBe("propuesta_mostrada_sin_registrar");
        return [{ type: "text", text: "Te preparé el consumo de 3 jeringas. Confirmalo en la tarjeta.", citations: null } as Anthropic.ContentBlock];
      },
    ]);
    const r = await runClaudeAssistant(db, [{ role: "user", content: "hoy gasté 3 jeringas" }], { model: "claude-haiku-5-5", client });
    // La tercera consulta (solo para redactar el cierre) ya no se hace: el servidor cierra.
    expect(client.calls).toBe(2);
    expect(r.mode).toBe("ia");
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].type).toBe("movimientos");
    expect(r.reply).toContain("confirmala en la tarjeta");
    expect((await getProduct(db, ids.jeringa))?.currentStock).toBe(5);
  });

  it("devuelve el error de validación al modelo para que pregunte", async () => {
    const client = scriptedClient([
      () => [
        {
          type: "tool_use",
          id: "t1",
          name: "proponer_movimientos",
          input: { movimientos: [{ producto_id: ids.guantesS, cantidad: 1, unidad: "caja", tipo: "consumo", motivo: null }], fecha: null },
        } as unknown as Anthropic.ContentBlock,
      ],
      (messages) => {
        const r = lastToolResult(messages);
        expect(r.is_error).toBe(true);
        expect(r.content).toContain("no está definida");
        return [{ type: "text", text: "¿Cuántos guantes trae cada caja?", citations: null } as Anthropic.ContentBlock];
      },
    ]);
    const r = await runClaudeAssistant(db, [{ role: "user", content: "usé una caja de guantes de nitrilo" }], { model: "x", client });
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("caja");
  });

  it("maneja una negativa del modelo sin propuestas", async () => {
    const client: MessagesClient = {
      messages: {
        async create() {
          return {
            id: "m",
            type: "message",
            role: "assistant",
            model: "x",
            content: [],
            stop_reason: "refusal",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          } as unknown as Anthropic.Message;
        },
      },
    };
    const r = await runClaudeAssistant(db, [{ role: "user", content: "algo" }], { model: "x", client });
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("No puedo ayudar");
  });
});

/* ------------------------- Gemini (cliente simulado) ------------------------- */

function geminiResponse(parts: Part[], finishReason: FinishReason = FinishReason.STOP): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), { candidates: [{ content: { role: "model", parts }, finishReason }] });
}

/** Gemini falso: cada paso recibe una copia del pedido (el bucle real modifica el arreglo después). */
function scriptedGemini(
  steps: ((contents: Content[], params: GenerateContentParameters) => GenerateContentResponse)[],
): GeminiClient & { calls: GenerateContentParameters[] } {
  const client = {
    calls: [] as GenerateContentParameters[],
    models: {
      async generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> {
        const snapshot = structuredClone(params);
        client.calls.push(snapshot);
        const step = steps[client.calls.length - 1] ?? steps[steps.length - 1];
        return step(snapshot.contents as Content[], snapshot);
      },
    },
  };
  return client;
}

const lastFunctionResponse = (contents: Content[]) => contents[contents.length - 1].parts![0].functionResponse!;

describe("agente con Gemini (cliente simulado)", () => {
  it("busca el producto, propone el consumo, devuelve las firmas de pensamiento y no registra nada", async () => {
    const client = scriptedGemini([
      () => geminiResponse([{ functionCall: { id: "c1", name: "buscar_productos", args: { texto: "jeringas" } }, thoughtSignature: "firma-1" }]),
      (contents) => {
        const model = contents[contents.length - 2];
        expect(model.role).toBe("model");
        expect(model.parts![0].thoughtSignature).toBe("firma-1");
        const fr = lastFunctionResponse(contents);
        expect(fr).toMatchObject({ id: "c1", name: "buscar_productos" });
        const id = (fr.response!.output as { coincidencias: { producto_id: string }[] }).coincidencias[0].producto_id;
        return geminiResponse([
          {
            functionCall: {
              id: "c2",
              name: "proponer_movimientos",
              args: { movimientos: [{ producto_id: id, cantidad: 3, unidad: null, tipo: "consumo", motivo: null }], fecha: null },
            },
            thoughtSignature: "firma-2",
          },
        ]);
      },
      (contents) => {
        expect((lastFunctionResponse(contents).response!.output as { estado: string }).estado).toBe("propuesta_mostrada_sin_registrar");
        return geminiResponse([{ text: "Te preparé el consumo de 3 jeringas. Confirmalo en la tarjeta." }]);
      },
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "hoy gasté 3 jeringas" }], { model: "gemini-flash-lite-latest", client });
    expect(client.calls).toHaveLength(2);
    const config = client.calls[0].config!;
    expect(config.tools![0]).toHaveProperty("functionDeclarations");
    expect(String(config.systemInstruction)).toContain("consultorIA");
    expect(config.automaticFunctionCalling).toEqual({ disable: true });
    expect(config.httpOptions?.retryOptions?.httpStatusCodes).not.toContain(429);
    expect(r).toMatchObject({ mode: "ia" });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].type).toBe("movimientos");
    expect(r.reply).toContain("confirmala en la tarjeta");
    expect((await getProduct(db, ids.jeringa))?.currentStock).toBe(5);
  });

  it("devuelve el error de validación en la clave «error» para que el modelo pregunte", async () => {
    const client = scriptedGemini([
      () =>
        geminiResponse([
          {
            functionCall: {
              name: "proponer_movimientos",
              args: { movimientos: [{ producto_id: ids.guantesS, cantidad: 1, unidad: "caja", tipo: "consumo", motivo: null }], fecha: null },
            },
          },
        ]),
      (contents) => {
        const fr = lastFunctionResponse(contents);
        expect(fr.id).toBeUndefined();
        expect(fr.response).toHaveProperty("error");
        expect(JSON.stringify(fr.response)).toContain("no está definida");
        return geminiResponse([{ text: "¿Cuántos guantes trae cada caja?" }]);
      },
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "usé una caja de guantes de nitrilo" }], { model: "x", client });
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("caja");
  });

  it("arma el historial con roles de Gemini y descarta respuestas iniciales del asistente", async () => {
    const client = scriptedGemini([() => geminiResponse([{ text: "Quedan 50 pares." }])]);
    await runGeminiAssistant(
      db,
      [
        { role: "assistant", content: "Hola" },
        { role: "user", content: "¿cuántos guantes quedan?" },
        { role: "assistant", content: "¿De látex o de nitrilo?" },
        { role: "user", content: "de nitrilo" },
      ],
      { model: "x", client },
    );
    expect((client.calls[0].contents as Content[]).map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("un pedido bloqueado por los filtros responde sin propuestas", async () => {
    const client = scriptedGemini([() => Object.assign(new GenerateContentResponse(), { candidates: [], promptFeedback: { blockReason: "SAFETY" } })]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "algo" }], { model: "x", client });
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("No puedo ayudar");
  });

  it("reintenta una vez si el modelo arma mal una llamada", async () => {
    const client = scriptedGemini([
      () => geminiResponse([], FinishReason.MALFORMED_FUNCTION_CALL),
      () => geminiResponse([{ text: "¿Qué producto usaste?" }]),
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "usé eso" }], { model: "x", client });
    expect(client.calls).toHaveLength(2);
    expect(r.reply).toBe("¿Qué producto usaste?");
  });

  it("si se agota el cupo de Gemini (429) responde con el modo básico y lo avisa", async () => {
    for (const k of ["ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "IA_PROVEEDOR", "IA_MODELO_ASISTENTE"]) vi.stubEnv(k, "");
    vi.stubEnv("GEMINI_API_KEY", "clave-de-prueba");
    try {
      const client: GeminiClient = {
        models: {
          async generateContent() {
            throw new ApiError({ status: 429, message: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}' });
          },
        },
      };
      const r = await runAssistant(db, [{ role: "user", content: "¿Qué productos están por agotarse?" }], { geminiClient: client });
      expect(r.mode).toBe("basico");
      expect(r.notice).toContain("límite de uso de Gemini");
      expect(r.reply).toContain("Pasta profiláctica");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("equivalencias inventadas por la IA (error 1 de la auditoría)", () => {
  it("rechaza «1 caja = 1» cuando la persona solo dijo «usamos 2 cajas» y no muestra tarjeta", async () => {
    const client = scriptedGemini([
      () =>
        geminiResponse([
          { text: "¿Cuántas unidades trae una caja?" },
          { functionCall: { id: "p1", name: "proponer_presentacion", args: { producto_id: ids.guantesS, nombre: "caja", equivale: 1 } } },
        ]),
      (contents) => {
        const fr = lastFunctionResponse(contents);
        expect(fr.response).toHaveProperty("error");
        expect(JSON.stringify(fr.response)).toContain("no la dijo la persona");
        return geminiResponse([{ text: "¿Cuántas unidades trae cada caja de guantes de nitrilo?" }]);
      },
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "usamos 2 cajas de guantes de nitrilo" }], { model: "x", client });
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("¿Cuántas unidades");
  });

  it("también rechaza usar la cantidad pedida como equivalencia (1 caja = 2)", async () => {
    const client = scriptedGemini([
      () => geminiResponse([{ functionCall: { name: "proponer_presentacion", args: { producto_id: ids.guantesS, nombre: "caja", equivale: 2 } } }]),
      (contents) => {
        expect(JSON.stringify(lastFunctionResponse(contents).response)).toContain("no la dijo la persona");
        return geminiResponse([{ text: "¿Cuántas trae cada caja?" }]);
      },
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "usamos 2 cajas de guantes de nitrilo" }], { model: "x", client });
    expect(r.proposals).toHaveLength(0);
  });

  it("acepta la equivalencia cuando la persona la dijo en la respuesta", async () => {
    const client = scriptedGemini([
      () => geminiResponse([{ functionCall: { name: "proponer_presentacion", args: { producto_id: ids.guantesS, nombre: "caja", equivale: 50 } } }]),
      () => geminiResponse([{ text: "Listo, preparé la presentación. Confirmala en la tarjeta." }]),
    ]);
    const r = await runGeminiAssistant(
      db,
      [
        { role: "user", content: "usamos 2 cajas de guantes de nitrilo" },
        { role: "assistant", content: "¿Cuántas unidades trae cada caja?" },
        { role: "user", content: "trae 50" },
      ],
      { model: "x", client },
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].type).toBe("presentacion");
  });

  it("valida igual las presentaciones de un producto nuevo (y con Claude)", async () => {
    const ok = scriptedClient([
      () => [
        {
          type: "tool_use",
          id: "t1",
          name: "proponer_producto",
          input: {
            nombre: "Guantes de vinilo",
            categoria: null,
            unidad_base: "unidad",
            stock_inicial: 200,
            stock_minimo: null,
            costo_unitario: null,
            controla_vencimiento: false,
            presentaciones: [{ nombre: "caja", equivale: 100 }],
          },
        } as unknown as Anthropic.ContentBlock,
      ],
      () => [{ type: "text", text: "Preparé el producto.", citations: null } as Anthropic.ContentBlock],
    ]);
    const r1 = await runClaudeAssistant(db, [{ role: "user", content: "Agregá dos cajas de guantes de vinilo, cada caja tiene 100 unidades" }], { model: "x", client: ok });
    expect(r1.proposals).toHaveLength(1);

    const bad = scriptedClient([
      () => [
        {
          type: "tool_use",
          id: "t1",
          name: "proponer_producto",
          input: {
            nombre: "Guantes de vinilo",
            categoria: null,
            unidad_base: "unidad",
            stock_inicial: 2,
            stock_minimo: null,
            costo_unitario: null,
            controla_vencimiento: false,
            presentaciones: [{ nombre: "caja", equivale: 1 }],
          },
        } as unknown as Anthropic.ContentBlock,
      ],
      (messages) => {
        expect(lastToolResult(messages).content).toContain("no la dijo la persona");
        return [{ type: "text", text: "¿Cuántas unidades trae cada caja?", citations: null } as Anthropic.ContentBlock];
      },
    ]);
    const r2 = await runClaudeAssistant(db, [{ role: "user", content: "Agregá dos cajas de guantes de vinilo" }], { model: "x", client: bad });
    expect(r2.proposals).toHaveLength(0);
  });
});

describe("presentación nueva y operación en el mismo pedido", () => {
  it("prepara la presentación y avisa al modelo que la operación espera la confirmación", async () => {
    const client = scriptedGemini([
      () =>
        geminiResponse([
          { functionCall: { id: "a", name: "proponer_presentacion", args: { producto_id: ids.guantesS, nombre: "caja", equivale: 50 } } },
          {
            functionCall: {
              id: "b",
              name: "proponer_movimientos",
              args: { movimientos: [{ producto_id: ids.guantesS, cantidad: 1, unidad: "cajas", tipo: "consumo", motivo: null }], fecha: null },
            },
          },
        ]),
      (contents) => {
        const parts = contents[contents.length - 1].parts!;
        expect(parts[0].functionResponse!.response).toHaveProperty("output");
        const mov = JSON.stringify(parts[1].functionResponse!.response);
        expect(mov).toContain("todavía no está confirmada");
        expect(mov).toContain("No digas que preparaste la operación");
        return geminiResponse([{ text: "Preparé la caja de 50. Confirmala y después te preparo el consumo." }]);
      },
    ]);
    const r = await runGeminiAssistant(
      db,
      [
        { role: "user", content: "usamos 1 caja de guantes de nitrilo" },
        { role: "assistant", content: "¿Cuántas unidades trae cada caja?" },
        { role: "user", content: "trae 50" },
      ],
      { model: "x", client },
    );
    expect(r.proposals.map((p) => p.type)).toEqual(["presentacion"]);
  });
});

describe("stock inicial de un producto nuevo con presentación", () => {
  it("rechaza cargar «2» cuando la persona dijo 2 cajas de 100 y pide 200", async () => {
    const product = (stock: number) => ({
      nombre: "Guantes de vinilo",
      categoria: null,
      unidad_base: "unidad",
      stock_inicial: stock,
      stock_minimo: null,
      costo_unitario: null,
      controla_vencimiento: false,
      presentaciones: [{ nombre: "caja", equivale: 100 }],
    });
    const client = scriptedGemini([
      () => geminiResponse([{ functionCall: { name: "proponer_producto", args: product(2) } }]),
      (contents) => {
        expect(JSON.stringify(lastFunctionResponse(contents).response)).toContain("2 caja × 100 = 200");
        return geminiResponse([{ functionCall: { name: "proponer_producto", args: product(200) } }]);
      },
      () => geminiResponse([{ text: "Preparé el producto con 200 unidades." }]),
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "Agregá dos cajas de guantes de vinilo, cada caja tiene 100 unidades" }], { model: "x", client });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ type: "producto", input: { initialStock: 200 } });
  });
});

describe("menos consultas por pedido (error 2 de la auditoría)", () => {
  it("con la búsqueda previa, «hoy gasté 3 jeringas descartables 5 ml» se resuelve en UNA consulta", async () => {
    let jeringaId = "";
    const client = scriptedGemini([
      (_contents, params) => {
        const sys = String(params.config?.systemInstruction);
        expect(sys).toContain("Búsqueda previa del sistema");
        const json = JSON.parse(sys.slice(sys.indexOf("[")));
        expect(json[0]).toMatchObject({ frase: expect.stringContaining("jeringa"), resolucion: "resuelto" });
        jeringaId = json[0].coincidencias[0].producto_id;
        return geminiResponse([
          {
            functionCall: {
              name: "proponer_movimientos",
              args: { movimientos: [{ producto_id: jeringaId, cantidad: 3, unidad: null, tipo: "consumo", motivo: null }], fecha: null },
            },
          },
        ]);
      },
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "hoy gasté 3 jeringas descartables 5 ml" }], { model: "x", client });
    expect(client.calls).toHaveLength(1);
    expect(jeringaId).toBe(ids.jeringa);
    expect(r.proposals).toHaveLength(1);
    expect(r.reply).toContain("revisala y confirmala");
  });

  it("si la búsqueda previa es ambigua, el modelo la ve y puede preguntar sin otra consulta", async () => {
    const client = scriptedGemini([
      (_contents, params) => {
        expect(String(params.config?.systemInstruction)).toContain('"resolucion":"ambiguo"');
        return geminiResponse([{ text: "¿De látex talle M o de nitrilo talle S?" }]);
      },
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "usamos 2 guantes" }], { model: "x", client });
    expect(client.calls).toHaveLength(1);
    expect(r.reply).toContain("¿De látex");
  });

  it("una consulta sin cantidades no lleva búsqueda previa", async () => {
    const client = scriptedGemini([
      (_contents, params) => {
        expect(String(params.config?.systemInstruction)).not.toContain("Búsqueda previa");
        return geminiResponse([{ text: "Listo." }]);
      },
    ]);
    await runGeminiAssistant(db, [{ role: "user", content: "¿Qué productos están por agotarse?" }], { model: "x", client });
  });

  it("si una propuesta falla, el modelo sí recibe el error para explicarlo (no cierra el servidor)", async () => {
    const client = scriptedGemini([
      () =>
        geminiResponse([
          {
            functionCall: {
              name: "proponer_movimientos",
              args: { movimientos: [{ producto_id: ids.jeringa, cantidad: 999, unidad: null, tipo: "consumo", motivo: null }], fecha: null },
            },
          },
        ]),
      () => geminiResponse([{ text: "No alcanza el stock: hay 5 jeringas." }]),
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "gasté 999 jeringas descartables 5 ml" }], { model: "x", client });
    expect(client.calls).toHaveLength(2);
    expect(r.reply).toContain("No alcanza");
  });

  it("registra cada consulta en el contador de uso, incluidas las rechazadas por límite", async () => {
    const { aiUsageSummary } = await import("@/lib/services/ai-usage");
    const before = (await aiUsageSummary(db)).today;
    const ok = scriptedGemini([() => geminiResponse([{ text: "Listo." }])]);
    await runGeminiAssistant(db, [{ role: "user", content: "hola" }], { model: "modelo-prueba", client: ok });
    const limited: GeminiClient = {
      models: {
        async generateContent() {
          throw new ApiError({ status: 429, message: "{}" });
        },
      },
    };
    await expect(runGeminiAssistant(db, [{ role: "user", content: "hola" }], { model: "modelo-prueba", client: limited })).rejects.toThrow();
    const after = (await aiUsageSummary(db)).today;
    expect(after.requests - before.requests).toBe(2);
    expect(after.limited - before.limited).toBe(1);
    expect(after.peakPerMinute).toBeGreaterThanOrEqual(2);
    const rows = await db.query<{ kind: string; model: string }>("select kind, model from ai_usage where model = 'modelo-prueba'");
    expect(rows.every((r) => r.kind === "asistente")).toBe(true);
  });
});

describe("pedido sin verbo (error 3 de la auditoría)", () => {
  const consumo = (cantidad: number) =>
    geminiResponse([
      {
        functionCall: {
          name: "proponer_movimientos",
          args: { movimientos: [{ producto_id: ids.jeringa, cantidad, unidad: null, tipo: "consumo", motivo: null }], fecha: null },
        },
      },
    ]);

  it("«jeringas 5» no se convierte en un consumo: el servidor exige preguntar", async () => {
    const client = scriptedGemini([
      () => consumo(5),
      (contents) => {
        const r = JSON.stringify(lastFunctionResponse(contents).response);
        expect(r).toContain("no dijo que fuera un consumo");
        return geminiResponse([{ text: "¿Las usaron (consumo) o entraron al stock (ingreso)?" }]);
      },
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "jeringas descartables 5 ml 5" }], { model: "x", client });
    expect(r.proposals).toHaveLength(0);
    expect(r.reply).toContain("consumo");
  });

  it("con la aclaración («las usamos») sí prepara el consumo", async () => {
    const client = scriptedGemini([() => consumo(5)]);
    const r = await runGeminiAssistant(
      db,
      [
        { role: "user", content: "jeringas descartables 5 ml 5" },
        { role: "assistant", content: "¿Las usaron o entraron?" },
        { role: "user", content: "las usamos" },
      ],
      { model: "x", client },
    );
    expect(r.proposals).toHaveLength(1);
  });

  it("tampoco acepta un ingreso si la persona habló de un consumo", async () => {
    const client = scriptedGemini([
      () =>
        geminiResponse([
          {
            functionCall: {
              name: "proponer_movimientos",
              args: { movimientos: [{ producto_id: ids.jeringa, cantidad: 3, unidad: null, tipo: "ingreso", motivo: null }], fecha: null },
            },
          },
        ]),
      () => geminiResponse([{ text: "Perdón, ¿fue un consumo?" }]),
    ]);
    const r = await runGeminiAssistant(db, [{ role: "user", content: "hoy gasté 3 jeringas" }], { model: "x", client });
    expect(r.proposals).toHaveLength(0);
  });
});
