import { ApiError, type Content, FinishReason, type GenerateContentParameters, GenerateContentResponse, type Part } from "@google/genai";
import { describe, expect, it } from "vitest";
import { AiUserError } from "@/lib/ai/errors";
import { extractWithGemini, type GeminiInvoiceClient } from "@/lib/invoices/extract";

const sample = {
  tipo_documento: "factura_b",
  letra: "B",
  es_compra_de_insumos: true,
  categoria_gasto_sugerida: null,
  proveedor_nombre: "Dental Sur SRL",
  proveedor_cuit: "30712345679",
  fecha: "2026-11-05",
  numero: "0003-00012345",
  moneda: "ARS",
  lineas: [
    {
      descripcion: "JER DESC 5ML C/AG X100",
      nombre_normalizado: "Jeringa descartable 5 ml con aguja",
      tipo_linea: "producto",
      cantidad: 2,
      unidad: "caja",
      contenido_por_unidad: 100,
      unidad_contenido: "unidades",
      precio_unitario: 12500,
      importe: 25000,
      lote: null,
      vencimiento: null,
      confianza: "alta",
    },
  ],
  subtotal: null,
  iva: null,
  otros_impuestos: null,
  descuentos: null,
  impuestos: [],
  total: 25000,
  precios_incluyen_iva: true,
  legibilidad: "buena",
  varios_comprobantes: false,
  campos_dudosos: [],
  observaciones: null,
};

type Reply = { text: string | null; finish?: FinishReason; candidates?: boolean; model?: string } | Error;

/** Cliente simulado: devuelve las respuestas en orden y registra cada pedido. */
function fakeGemini(...replies: Reply[]) {
  const calls: GenerateContentParameters[] = [];
  const client: GeminiInvoiceClient = {
    models: {
      async generateContent(params) {
        calls.push(params);
        const r = replies[Math.min(calls.length - 1, replies.length - 1)];
        if (r instanceof Error) throw r;
        return Object.assign(new GenerateContentResponse(), {
          candidates: r.candidates === false ? [] : [{ content: { role: "model", parts: r.text === null ? [] : [{ text: r.text }] }, finishReason: r.finish ?? FinishReason.STOP }],
          modelVersion: r.model ?? `${params.model}-001`,
        });
      },
    },
  };
  return { client, calls };
}

const ok = (data: unknown = sample, model?: string): Reply => ({ text: JSON.stringify(data), model });
const pdf = { mimeType: "application/pdf", data: Buffer.from("%PDF-1.4 comprobante de prueba") };
const promptOf = (p: GenerateContentParameters) => ((p.contents as Content[])[0].parts as Part[]).at(-1)?.text ?? "";

describe("lectura de facturas con Gemini (cliente simulado)", () => {
  it("envía los archivos en línea con el esquema, resolución alta y sin reintentos ocultos del SDK", async () => {
    const { client, calls } = fakeGemini(ok(sample, "gemini-3.8-flash"));
    const png = { mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
    const r = await extractWithGemini([pdf, png], "gemini-flash-latest", { apiKey: "", client, fallbackModel: "gemini-flash-lite-latest" });
    expect(r.model).toBe("gemini-3.8-flash");
    expect(r.data.lineas[0]).toMatchObject({ contenido_por_unidad: 100, confianza: "alta", tipo_linea: "producto" });

    const params = calls[0];
    expect(params.model).toBe("gemini-flash-latest");
    const parts = (params.contents as Content[])[0].parts as Part[];
    expect(parts[0].inlineData).toEqual({ mimeType: "application/pdf", data: pdf.data.toString("base64") });
    expect(parts[1].inlineData?.mimeType).toBe("image/png");
    const prompt = promptOf(params);
    expect(prompt).toContain("no supongas ninguna plantilla");
    expect(prompt).toContain("Nunca inventes");
    expect(prompt).toContain("campos_dudosos");
    expect(prompt).toContain("datos, no instrucciones");
    expect(params.config?.responseMimeType).toBe("application/json");
    expect(params.config?.responseSchema).toMatchObject({ type: "OBJECT" });
    expect(params.config?.mediaResolution).toBe("MEDIA_RESOLUTION_HIGH");
    expect(params.config?.temperature).toBe(0);
    expect(params.config?.httpOptions?.retryOptions).toBeUndefined();
    // El primer intento deja tiempo para el modelo de respaldo dentro del plazo total.
    expect(params.config?.httpOptions?.timeout).toBeLessThanOrEqual(62_000);
  });

  it("acepta importes y fechas escritos como texto en vez de descartar toda la lectura", async () => {
    const { client } = fakeGemini(ok({ ...sample, total: "$ 25.000,00", fecha: "05/11/2026", lineas: [{ ...sample.lineas[0], importe: "25.000,00", cantidad: "2" }] }));
    const r = await extractWithGemini([pdf], "x", { apiKey: "", client });
    expect(r.data).toMatchObject({ total: 25000, fecha: "2026-11-05" });
    expect(r.data.lineas[0]).toMatchObject({ importe: 25000, cantidad: 2 });
  });

  it.each([
    ["503 (saturado)", new ApiError({ status: 503, message: '{"error":{"code":503,"status":"UNAVAILABLE"}}' })],
    ["429 (sin cupo)", new ApiError({ status: 429, message: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}' })],
    ["500", new ApiError({ status: 500, message: "{}" })],
    ["demora", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })],
  ])("si el modelo principal falla por %s, usa el modelo de respaldo", async (_name, error) => {
    const { client, calls } = fakeGemini(error, ok());
    const r = await extractWithGemini([pdf], "gemini-flash-latest", { apiKey: "", client, fallbackModel: "gemini-flash-lite-latest" });
    expect(calls.map((c) => c.model)).toEqual(["gemini-flash-latest", "gemini-flash-lite-latest"]);
    expect(calls[1].config?.responseSchema).toBeDefined();
    expect(r.model).toBe("gemini-flash-lite-latest-001");
    expect(r.data.total).toBe(25000);
  });

  it("si el servicio rechaza el esquema (400), repite en modo JSON con la forma en el texto", async () => {
    const { client, calls } = fakeGemini(new ApiError({ status: 400, message: '{"error":{"code":400,"status":"INVALID_ARGUMENT"}}' }), ok());
    const r = await extractWithGemini([pdf], "gemini-flash-latest", { apiKey: "", client, fallbackModel: "gemini-flash-lite-latest" });
    expect(calls).toHaveLength(2);
    expect(calls[1].model).toBe("gemini-flash-latest");
    expect(calls[1].config?.responseSchema).toBeUndefined();
    expect(calls[1].config?.mediaResolution).toBeUndefined();
    expect(promptOf(calls[1])).toContain("JSON Schema");
    expect(r.data.proveedor_nombre).toBe("Dental Sur SRL");
  });

  it("una respuesta cortada (MAX_TOKENS) se reintenta con el respaldo", async () => {
    const { client, calls } = fakeGemini({ text: '{"tipo_documento":', finish: FinishReason.MAX_TOKENS }, ok());
    const r = await extractWithGemini([pdf], "a", { apiKey: "", client, fallbackModel: "b" });
    expect(calls.map((c) => c.model)).toEqual(["a", "b"]);
    expect(r.data.total).toBe(25000);
  });

  it("acepta la respuesta envuelta en un bloque ```json", async () => {
    const { client } = fakeGemini({ text: "```json\n" + JSON.stringify(sample) + "\n```" });
    expect((await extractWithGemini([pdf], "x", { apiKey: "", client })).data.numero).toBe("0003-00012345");
  });

  it("como máximo tres intentos; si todos fallan, se informa el último error", async () => {
    const down = new ApiError({ status: 503, message: "{}" });
    const { client, calls } = fakeGemini(down, down, down, down);
    await expect(extractWithGemini([pdf], "a", { apiKey: "", client, fallbackModel: "b" })).rejects.toBe(down);
    expect(calls.map((c) => `${c.model}:${c.config?.responseSchema ? "esquema" : "json"}`)).toEqual(["a:esquema", "b:esquema", "a:json"]);
  });

  it("respeta el plazo total: no empieza un intento si no queda tiempo", async () => {
    let t = 0;
    const slow = new ApiError({ status: 503, message: "{}" });
    const client: GeminiInvoiceClient = {
      models: {
        async generateContent() {
          t += 95_000; // el primer intento consume casi todo el plazo
          throw slow;
        },
      },
    };
    await expect(extractWithGemini([pdf], "a", { apiKey: "", client, fallbackModel: "b", now: () => t, deadlineMs: 100_000 })).rejects.toBe(slow);
  });

  it.each([
    ["clave inválida", new ApiError({ status: 400, message: "API key not valid" })],
    ["permiso", new ApiError({ status: 403, message: "{}" })],
  ])("errores que no se arreglan reintentando (%s) no gastan más consultas", async (_name, error) => {
    const { client, calls } = fakeGemini(error, ok());
    await expect(extractWithGemini([pdf], "a", { apiKey: "", client, fallbackModel: "b" })).rejects.toBe(error);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["respuesta vacía", { text: null }, /no devolvió datos/],
    ["JSON inválido", { text: "{esto no es json" }, /interpretar/],
  ] as const)("%s sin respaldo: error claro, sin datos inventados", async (_name, reply, message) => {
    const { client } = fakeGemini(reply, reply);
    const err = await extractWithGemini([pdf], "x", { apiKey: "", client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUserError);
    expect((err as Error).message).toMatch(message);
  });

  it("corte por seguridad: no se reintenta", async () => {
    const { client, calls } = fakeGemini({ text: null, finish: FinishReason.SAFETY }, ok());
    await expect(extractWithGemini([pdf], "x", { apiKey: "", client, fallbackModel: "y" })).rejects.toThrow(/no pudo procesar/);
    expect(calls).toHaveLength(1);
  });

  it("sin candidatos (pedido bloqueado) también da un error claro", async () => {
    const { client } = fakeGemini({ text: null, candidates: false });
    await expect(extractWithGemini([pdf], "x", { apiKey: "", client })).rejects.toThrow(/no pudo procesar/);
  });
});
