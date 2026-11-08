import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runClaudeAssistant, type MessagesClient } from "@/lib/agent/claude";
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
    expect(client.calls).toBe(3);
    expect(r.mode).toBe("ia");
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].type).toBe("movimientos");
    expect(r.reply).toContain("Confirmalo");
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
