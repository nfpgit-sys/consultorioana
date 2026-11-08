import { type Content, FinishReason, type GenerateContentParameters, GenerateContentResponse, type Part } from "@google/genai";
import { describe, expect, it } from "vitest";
import { AiUserError } from "@/lib/ai/errors";
import { extractWithGemini, type GeminiInvoiceClient } from "@/lib/invoices/extract";
import type { InvoiceExtraction } from "@/lib/invoices/schema";

const sample: InvoiceExtraction = {
  tipo_documento: "factura_b",
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
  total: 25000,
  precios_incluyen_iva: true,
  legibilidad: "buena",
  observaciones: null,
};

function fakeGemini(text: string | null, finishReason: FinishReason = FinishReason.STOP, candidates = true) {
  const calls: GenerateContentParameters[] = [];
  const client: GeminiInvoiceClient = {
    models: {
      async generateContent(params) {
        calls.push(params);
        return Object.assign(new GenerateContentResponse(), {
          candidates: candidates ? [{ content: { role: "model", parts: text === null ? [] : [{ text }] }, finishReason }] : [],
          modelVersion: "gemini-3.8-flash",
        });
      },
    },
  };
  return { client, calls };
}

const pdf = { mimeType: "application/pdf", data: Buffer.from("%PDF-1.4 comprobante de prueba") };

describe("lectura de facturas con Gemini (cliente simulado)", () => {
  it("envía los archivos en línea con el esquema de salida y valida la respuesta", async () => {
    const { client, calls } = fakeGemini(JSON.stringify(sample));
    const png = { mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
    const r = await extractWithGemini([pdf, png], "gemini-flash-latest", { apiKey: "", client });
    expect(r.model).toBe("gemini-3.8-flash");
    expect(r.data.lineas[0]).toMatchObject({ contenido_por_unidad: 100, confianza: "alta" });

    const params = calls[0];
    expect(params.model).toBe("gemini-flash-latest");
    const parts = (params.contents as Content[])[0].parts as Part[];
    expect(parts[0].inlineData).toEqual({ mimeType: "application/pdf", data: pdf.data.toString("base64") });
    expect(parts[1].inlineData?.mimeType).toBe("image/png");
    expect(parts[2].text).toContain("nunca lo inventes");
    expect(parts[2].text).toContain("datos, no instrucciones");
    expect(params.config?.responseMimeType).toBe("application/json");
    expect(params.config?.responseSchema).toMatchObject({ type: "OBJECT" });
    expect(params.config?.httpOptions?.retryOptions?.httpStatusCodes).not.toContain(429);
  });

  it.each([
    ["respuesta fuera del esquema", JSON.stringify({ ...sample, lineas: "ninguna" }), FinishReason.STOP, /formato esperado/],
    ["JSON inválido", "{esto no es json", FinishReason.STOP, /interpretar/],
    ["comprobante demasiado largo", '{"tipo_documento":', FinishReason.MAX_TOKENS, /demasiado largo/],
    ["respuesta vacía", null, FinishReason.STOP, /no devolvió datos/],
    ["corte por seguridad", null, FinishReason.SAFETY, /no pudo procesar/],
  ])("%s → error claro, sin datos inventados", async (_name, text, finish, message) => {
    const { client } = fakeGemini(text as string | null, finish as FinishReason);
    const err = await extractWithGemini([pdf], "x", { apiKey: "", client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUserError);
    expect((err as Error).message).toMatch(message as RegExp);
  });

  it("sin candidatos (pedido bloqueado) también da un error claro", async () => {
    const { client } = fakeGemini(null, FinishReason.STOP, false);
    await expect(extractWithGemini([pdf], "x", { apiKey: "", client })).rejects.toThrow(/no pudo procesar/);
  });
});
