import { isAuthenticated } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { getDocument } from "@/lib/services/documents";
import { readStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Sirve el archivo original de una factura (solo con sesión válida). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  if (!(await isAuthenticated())) return new Response("No autorizado", { status: 401 });
  const { id, fileId } = await params;
  const doc = await getDocument(await getDb(), id);
  const file = doc?.files.find((f) => f.id === fileId);
  if (!file) return new Response("No encontrado", { status: 404 });
  const data = await readStoredFile(file.storage, file.storageKey);
  if (!data) return new Response("No hay copia guardada de este archivo", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
