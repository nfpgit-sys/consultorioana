import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { todayAR } from "@/lib/domain/format";
import { type InvoiceExtraction, InvoiceExtractionSchema } from "./schema";

export interface InvoiceFileInput {
  mimeType: string;
  data: Buffer;
}

const PROMPT = `Sos un asistente que lee comprobantes de compra de un consultorio odontológico en Argentina (facturas A/B/C, tickets, recibos, remitos).
Extraé los datos del comprobante adjunto (puede tener varias páginas o fotos).

Reglas:
- Copiá los datos tal como figuran. Si un dato no está o no se lee con seguridad, poné null: nunca lo inventes ni lo estimes.
- Números en formato decimal estándar (1234.56): en los comprobantes argentinos el punto separa miles y la coma, decimales.
- Fechas en AAAA-MM-DD (el comprobante usa DD/MM/AAAA).
- Una entrada en "lineas" por cada renglón de producto o servicio. No incluyas como línea los subtotales, IVA ni percepciones.
- En "nombre_normalizado" escribí el nombre claro del producto expandiendo abreviaturas habituales (DESC = descartable, C/ = con, S/ = sin, CJ = caja, X100 = por 100 unidades, etc.).
- Si la descripción indica cuánto trae cada unidad de venta (por ejemplo "CAJA X 100" o "x50 u"), completá contenido_por_unidad y unidad_contenido.
- Marcá confianza "baja" en las líneas con texto dudoso o borroso, y explicá los problemas en "observaciones".
- Indicá si los importes de las líneas incluyen IVA (facturas B, C y tickets suelen incluirlo; en la factura A suele estar discriminado).`;

/**
 * Extrae los datos de una factura con Claude (modelo potente, configurable).
 * Usa salidas estructuradas y el mecanismo de respaldo del servidor si el modelo principal declina.
 */
export async function extractInvoice(files: InvoiceFileInput[], model: string): Promise<{ data: InvoiceExtraction; model: string }> {
  const client = new Anthropic({ timeout: 110_000, maxRetries: 1 });
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of files) {
    const b64 = f.data.toString("base64");
    if (f.mimeType === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
    } else {
      const media = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.mimeType) ? f.mimeType : "image/jpeg") as
        | "image/jpeg"
        | "image/png"
        | "image/webp"
        | "image/gif";
      blocks.push({ type: "image", source: { type: "base64", media_type: media, data: b64 } });
    }
  }
  blocks.push({ type: "text", text: `${PROMPT}\n\nFecha de hoy (referencia): ${todayAR()}.` });

  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(InvoiceExtractionSchema) },
    messages: [{ role: "user", content: blocks }],
  });
  if (response.stop_reason === "refusal") throw new Error("El modelo no pudo procesar este documento.");
  if (response.stop_reason === "max_tokens") throw new Error("El comprobante es demasiado largo para leerlo de una vez.");
  if (!response.parsed_output) throw new Error("No se pudo interpretar la respuesta del modelo.");
  return { data: response.parsed_output, model: response.model };
}
