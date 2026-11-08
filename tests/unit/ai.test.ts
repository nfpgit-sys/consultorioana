import { ApiError, Type } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { describeAiError } from "@/lib/ai/errors";
import { toGeminiSchema } from "@/lib/ai/gemini-schema";
import { GEMINI_FUNCTIONS } from "@/lib/agent/gemini";
import { getAiConfig } from "@/lib/config";
import { GEMINI_INVOICE_SCHEMA } from "@/lib/invoices/extract";

describe("conversión de esquemas para Gemini", () => {
  it("convierte tipos anulables, enums y objetos", () => {
    const schema = toGeminiSchema({
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre" },
        unidad: { type: ["string", "null"] },
        tipo: { type: ["string", "null"], enum: ["consumo", "ingreso", null] },
        cantidad: { type: "number" },
        limite: { type: ["integer", "null"] },
        lineas: { type: "array", items: { type: "object", properties: { x: { type: "boolean" } }, required: ["x"], additionalProperties: false } },
      },
      required: ["nombre", "unidad", "tipo", "cantidad", "limite", "lineas"],
      additionalProperties: false,
    }, { ordering: true });
    expect(schema.type).toBe(Type.OBJECT);
    expect(schema.propertyOrdering).toEqual(["nombre", "unidad", "tipo", "cantidad", "limite", "lineas"]);
    expect(schema.required).toHaveLength(6);
    expect(schema.properties!.nombre).toEqual({ type: Type.STRING, description: "Nombre" });
    expect(schema.properties!.unidad).toEqual({ type: Type.STRING, nullable: true });
    expect(schema.properties!.tipo).toEqual({ type: Type.STRING, nullable: true, enum: ["consumo", "ingreso"], format: "enum" });
    expect(schema.properties!.limite).toEqual({ type: Type.INTEGER, nullable: true });
    expect(schema.properties!.lineas.items).toMatchObject({ type: Type.OBJECT, required: ["x"], properties: { x: { type: Type.BOOLEAN } } });
    expect(JSON.stringify(schema)).not.toContain("additionalProperties");
  });

  it("entiende el formato anulable de zod (anyOf con null) y conserva la descripción", () => {
    const js = z.toJSONSchema(z.object({ cuit: z.string().nullable().describe("CUIT del emisor"), ok: z.boolean() }));
    const schema = toGeminiSchema(js);
    expect(schema.properties!.cuit).toEqual({ type: Type.STRING, nullable: true, description: "CUIT del emisor" });
    expect(schema.properties!.ok).toEqual({ type: Type.BOOLEAN });
  });

  it("rechaza uniones de tipos que Gemini no admite", () => {
    expect(() => toGeminiSchema({ type: ["string", "number"] })).toThrow(/uniones/);
  });

  it("las herramientas sin parámetros van sin esquema y las demás conservan los obligatorios", () => {
    const byName = Object.fromEntries(GEMINI_FUNCTIONS.map((f) => [f.name, f]));
    expect(byName.listar_stock_bajo.parameters).toBeUndefined();
    expect(byName.buscar_productos.parameters).toMatchObject({ type: Type.OBJECT, required: ["texto"] });
    const mov = byName.proponer_movimientos.parameters!.properties!.movimientos.items!;
    expect(mov.properties!.unidad).toMatchObject({ type: Type.STRING, nullable: true });
    expect(mov.properties!.tipo).toMatchObject({ enum: ["consumo", "ingreso"] });
    expect(GEMINI_FUNCTIONS).toHaveLength(14);
    expect(JSON.stringify(GEMINI_FUNCTIONS)).not.toContain("propertyOrdering");
  });

  it("el esquema de facturas exige todos los campos y admite null donde corresponde", () => {
    expect(GEMINI_INVOICE_SCHEMA.type).toBe(Type.OBJECT);
    expect(GEMINI_INVOICE_SCHEMA.required).toContain("lineas");
    expect(GEMINI_INVOICE_SCHEMA.properties!.proveedor_cuit).toMatchObject({ type: Type.STRING, nullable: true });
    expect(GEMINI_INVOICE_SCHEMA.properties!.tipo_documento.enum).toContain("factura_a");
    expect(GEMINI_INVOICE_SCHEMA.propertyOrdering?.[0]).toBe("tipo_documento");
    const linea = GEMINI_INVOICE_SCHEMA.properties!.lineas.items!;
    expect(linea.properties!.confianza.enum).toEqual(["alta", "media", "baja"]);
    expect(linea.properties!.cantidad).toMatchObject({ type: Type.NUMBER, nullable: true });
  });
});

describe("selección del proveedor de IA", () => {
  afterEach(() => vi.unstubAllEnvs());
  const env = (vars: Record<string, string | undefined>) => {
    for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "IA_PROVEEDOR", "IA_MODELO_ASISTENTE", "IA_MODELO_FACTURAS"]) {
      vi.stubEnv(k, vars[k] ?? "");
    }
  };

  it("sin claves queda desactivada y pide GEMINI_API_KEY", () => {
    env({});
    const ai = getAiConfig();
    expect(ai.enabled).toBe(false);
    if (!ai.enabled) expect(ai.reason).toContain("GEMINI_API_KEY");
  });

  it("con GEMINI_API_KEY usa Gemini con los alias por defecto y muestra el aviso de privacidad", () => {
    env({ GEMINI_API_KEY: "clave-falsa" });
    expect(getAiConfig()).toMatchObject({
      enabled: true,
      provider: "gemini",
      keyVar: "GEMINI_API_KEY",
      assistantModel: "gemini-flash-lite-latest",
      invoiceModel: "gemini-flash-latest",
      privacyNote: expect.stringContaining("pacientes"),
    });
    expect(JSON.stringify(getAiConfig())).not.toContain("clave-falsa");
  });

  it("acepta GOOGLE_API_KEY y prioriza Gemini si hay dos claves", () => {
    env({ GOOGLE_API_KEY: "g" });
    expect(getAiConfig()).toMatchObject({ provider: "gemini", keyVar: "GOOGLE_API_KEY" });
    env({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" });
    expect(getAiConfig()).toMatchObject({ provider: "gemini" });
  });

  it("IA_PROVEEDOR elige Claude y valida que exista su clave", () => {
    env({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", IA_PROVEEDOR: "claude" });
    expect(getAiConfig()).toMatchObject({ provider: "anthropic", assistantModel: "claude-haiku-5-5", privacyNote: null });
    env({ GEMINI_API_KEY: "g", IA_PROVEEDOR: "claude" });
    expect(getAiConfig()).toMatchObject({ enabled: false, reason: expect.stringContaining("ANTHROPIC_API_KEY") });
    env({ GEMINI_API_KEY: "g", IA_PROVEEDOR: "otro" });
    expect(getAiConfig()).toMatchObject({ enabled: false, reason: expect.stringContaining("no válido") });
  });

  it("los modelos se pueden cambiar por variables de entorno", () => {
    env({ GEMINI_API_KEY: "g", IA_MODELO_ASISTENTE: "gemini-3.5-flash-lite", IA_MODELO_FACTURAS: "gemini-3.8-flash" });
    expect(getAiConfig()).toMatchObject({ assistantModel: "gemini-3.5-flash-lite", invoiceModel: "gemini-3.8-flash" });
  });
});

describe("errores de la IA en palabras simples", () => {
  const gemini = (status: number, message = "{}") => new ApiError({ status, message });

  it.each([
    [gemini(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}'), "limite"],
    [gemini(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'), "clave"],
    [gemini(400, '{"error":{"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}'), "region"],
    [gemini(403), "permiso"],
    [gemini(404, '{"error":{"status":"NOT_FOUND"}}'), "modelo"],
    [gemini(503, '{"error":{"status":"UNAVAILABLE"}}'), "servicio"],
    [gemini(400, '{"error":{"status":"INVALID_ARGUMENT"}}'), "rechazo"],
    [Object.assign(new Error("timeout"), { name: "TimeoutError" }), "demora"],
    [new TypeError("fetch failed"), "conexion"],
    [new Error("otra cosa"), "desconocido"],
  ])("%s → %s", (err, kind) => {
    const info = describeAiError(err);
    expect(info.kind).toBe(kind);
    expect(info.message).not.toMatch(/API key not valid|RESOURCE_EXHAUSTED/);
  });
});
