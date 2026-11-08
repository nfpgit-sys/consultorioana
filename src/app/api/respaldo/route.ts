import { gunzipSync } from "node:zlib";
import { getActionContext, isAuthenticated } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { todayAR } from "@/lib/domain/format";
import { exportBackup, restoreBackup } from "@/lib/services/backup";
import { isDomainError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Descarga del respaldo completo en JSON. */
export async function GET() {
  if (!(await isAuthenticated())) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const backup = await exportBackup(await getDb());
    return new Response(JSON.stringify(backup), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="consultoria-respaldo-${todayAR()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[respaldo]", err);
    return Response.json({ error: "No se pudo generar el respaldo." }, { status: 500 });
  }
}

/**
 * Restauración: reemplaza todos los datos. Requiere el encabezado X-Confirmacion: RESTAURAR.
 * Acepta JSON plano o comprimido con gzip (Content-Encoding del cliente: X-Comprimido: gzip).
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "No autorizado" }, { status: 401 });
  if (request.headers.get("x-confirmacion") !== "RESTAURAR") {
    return Response.json({ error: "Falta la confirmación explícita para restaurar." }, { status: 400 });
  }
  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    const text = request.headers.get("x-comprimido") === "gzip" ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return Response.json({ error: "El archivo no es un JSON válido." }, { status: 400 });
    }
    const ctx = await getActionContext("manual");
    const restored = await restoreBackup(await getDb(), data, ctx);
    return Response.json({ ok: true, restored });
  } catch (err) {
    if (isDomainError(err)) return Response.json({ error: err.message }, { status: err.status });
    console.error("[restaurar]", err);
    return Response.json({ error: "No se pudo restaurar. La base quedó como estaba." }, { status: 500 });
  }
}
