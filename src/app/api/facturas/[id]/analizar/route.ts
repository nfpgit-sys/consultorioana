import { isAuthenticated } from "@/lib/auth/server";
import { getAiConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { extractInvoice } from "@/lib/invoices/extract";
import { getDocument, saveExtraction } from "@/lib/services/documents";
import { readStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Vuelve a analizar una factura guardada (por ejemplo, después de un error). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return Response.json({ error: "No autorizado" }, { status: 401 });
  const ai = getAiConfig();
  if (!ai.enabled) return Response.json({ error: "La lectura automática necesita la IA configurada." }, { status: 400 });
  const { id } = await params;
  const db = await getDb();
  const doc = await getDocument(db, id);
  if (!doc) return Response.json({ error: "La factura no existe." }, { status: 404 });
  if (doc.status === "registrado" || doc.status === "descartado") return Response.json({ error: "La factura ya fue procesada." }, { status: 409 });
  const files: { mimeType: string; data: Buffer }[] = [];
  for (const f of doc.files) {
    const data = await readStoredFile(f.storage, f.storageKey);
    if (!data) return Response.json({ error: "No hay una copia guardada del archivo: subilo de nuevo." }, { status: 409 });
    files.push({ mimeType: f.mimeType, data });
  }
  try {
    await saveExtraction(db, id, await extractInvoice(files, ai, db));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[facturas] reintento fallido:", err);
    await saveExtraction(db, id, { error: err instanceof Error ? err.message : "Error desconocido" });
    return Response.json({ error: "No se pudo leer la factura. Podés cargar los datos a mano." }, { status: 502 });
  }
}
