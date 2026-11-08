import { z } from "zod";
import { isAuthenticated } from "@/lib/auth/server";
import { DatabaseNotConfiguredError, getDb } from "@/lib/db";
import { runAssistant } from "@/lib/agent";
import { describeProposal } from "@/lib/agent/proposals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .min(1)
    .max(40),
});

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Necesitás ingresar con la clave del consultorio." }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  if (body.messages[body.messages.length - 1].role !== "user") {
    return Response.json({ error: "El último mensaje tiene que ser de la persona." }, { status: 400 });
  }
  try {
    const db = await getDb();
    const result = await runAssistant(db, body.messages);
    const proposals = result.proposals.map((p) => ({ ...p, summary: describeProposal(p) }));
    return Response.json({ ...result, proposals }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return Response.json({ error: "La base de datos no está configurada." }, { status: 503 });
    }
    console.error("[asistente]", err);
    return Response.json({ error: "El asistente tuvo un problema. No se registró nada; probá de nuevo." }, { status: 500 });
  }
}
