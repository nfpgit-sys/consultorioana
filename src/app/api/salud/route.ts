import { getDb } from "@/lib/db";
import { getDbConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Chequeo público mínimo para verificar un despliegue: indica si la base responde
 * y las migraciones están aplicadas. No expone configuración ni datos.
 */
export async function GET() {
  const started = Date.now();
  const cfg = getDbConfig();
  if (cfg.kind === "missing") {
    return Response.json({ ok: false, base: "sin_configurar" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const db = await getDb();
    const [row] = await db.query<{ version: string }>("select max(version) as version from schema_migrations");
    return Response.json(
      { ok: true, base: "ok", esquema: row?.version ?? null, ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[salud]", err);
    return Response.json({ ok: false, base: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
