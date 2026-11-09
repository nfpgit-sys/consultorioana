import { randomUUID } from "node:crypto";
import { getActionContext, isAuthenticated } from "@/lib/auth/server";
import { getAiConfig } from "@/lib/config";
import { DatabaseNotConfiguredError, getDb } from "@/lib/db";
import { extractInvoice } from "@/lib/invoices/extract";
import { createDocument, saveExtraction, sha256 } from "@/lib/services/documents";
import { saveFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 6;
const MAX_TOTAL_BYTES = 4_300_000; // límite de cuerpo de las funciones de Vercel: 4,5 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Sube una factura (fotos o PDF), la guarda y, si la IA está configurada, la analiza. */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Necesitás ingresar con la clave del consultorio." }, { status: 401 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "No se pudieron leer los archivos. Si el PDF es muy grande, probá con fotos." }, { status: 400 });
  }
  const files = form.getAll("archivos").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (files.length === 0) return Response.json({ error: "Elegí al menos un archivo." }, { status: 400 });
  if (files.length > MAX_FILES) return Response.json({ error: `Máximo ${MAX_FILES} archivos por factura.` }, { status: 400 });
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return Response.json({ error: "Los archivos superan los 4 MB. Probá con fotos (se comprimen solas) o un PDF más liviano." }, { status: 413 });
  }
  const pdfs = files.filter((f) => f.type === "application/pdf");
  if (pdfs.length > 1 || (pdfs.length === 1 && files.length > 1)) {
    return Response.json({ error: "Subí un solo PDF, o una o varias fotos del mismo comprobante." }, { status: 400 });
  }
  for (const f of files) {
    if (!ALLOWED.includes(f.type)) return Response.json({ error: `Formato no admitido: ${f.name}. Usá JPG, PNG, WEBP o PDF.` }, { status: 415 });
  }

  try {
    const ctx = await getActionContext("factura");
    const db = await getDb();
    const documentId = randomUUID();
    const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
    const notices: string[] = [];
    const stored = [];
    for (const [i, f] of files.entries()) {
      let s: { storage: "blob" | "local" | "none"; key: string | null };
      try {
        s = await saveFile(documentId, f.name, f.type, buffers[i]);
      } catch (err) {
        console.error("[facturas] no se pudo guardar el archivo:", err);
        s = { storage: "none", key: null };
        notices.push("No se pudo guardar una copia del archivo; los datos se pueden revisar igual.");
      }
      stored.push({ fileName: f.name, mimeType: f.type, sizeBytes: f.size, sha256: sha256(buffers[i]), storage: s.storage, storageKey: s.key });
    }
    const doc = await createDocument(db, stored, ctx, documentId);

    const ai = getAiConfig();
    if (!ai.enabled) {
      return Response.json({ documentId: doc.id, status: "pendiente", notice: "La lectura automática necesita la IA configurada: podés cargar los datos a mano." });
    }
    try {
      const result = await extractInvoice(
        files.map((f, i) => ({ mimeType: f.type, data: buffers[i] })),
        ai,
        db,
      );
      await saveExtraction(db, doc.id, result);
      return Response.json({ documentId: doc.id, status: "analizado", notice: notices[0] ?? null });
    } catch (err) {
      console.error("[facturas] error de extracción:", err);
      const message = err instanceof Error ? err.message : "Error desconocido";
      await saveExtraction(db, doc.id, { error: message });
      return Response.json({ documentId: doc.id, status: "error", notice: "No se pudo leer la factura automáticamente. Podés reintentar o cargar los datos a mano." });
    }
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) return Response.json({ error: "La base de datos no está configurada." }, { status: 503 });
    console.error("[facturas]", err);
    return Response.json({ error: "No se pudo procesar la factura. No se registró nada." }, { status: 500 });
  }
}
