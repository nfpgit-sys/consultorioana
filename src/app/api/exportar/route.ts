import { isAuthenticated } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { isValidIsoDate, todayAR } from "@/lib/domain/format";
import { buildWorkbook, type ExportKind } from "@/lib/services/export";
import { uuid } from "@/lib/services/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KINDS: ExportKind[] = ["inventario", "movimientos", "compras", "gastos", "consumos", "todo"];

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(request.url);
  const kind = (KINDS.includes(url.searchParams.get("tipo") as ExportKind) ? url.searchParams.get("tipo") : "todo") as ExportKind;
  const from = url.searchParams.get("desde");
  const to = url.searchParams.get("hasta");
  const productId = url.searchParams.get("producto");
  try {
    const db = await getDb();
    const buffer = await buildWorkbook(db, kind, {
      from: from && isValidIsoDate(from) ? from : null,
      to: to && isValidIsoDate(to) ? to : null,
      productId: productId && uuid.safeParse(productId).success ? productId : null,
      category: url.searchParams.get("categoria") || null,
    });
    const name = `consultoria-${kind}-${todayAR()}.xlsx`;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[exportar]", err);
    return Response.json({ error: "No se pudo generar el archivo. Probá de nuevo." }, { status: 500 });
  }
}
