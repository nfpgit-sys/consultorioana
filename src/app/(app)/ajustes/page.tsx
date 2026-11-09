import { CheckCircle2, CircleAlert, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { BackupPanel } from "@/components/settings/backup-panel";
import { DeviceNameForm } from "@/components/settings/device-name-form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { getActorName } from "@/lib/auth/server";
import { getAiConfig, getAuthConfig, getDbConfig, getStorageConfig } from "@/lib/config";
import { formatDate, formatDateTime } from "@/lib/domain/format";
import { loadData } from "@/lib/server/load";
import { aiUsageSummary } from "@/lib/services/ai-usage";
import { getSetting } from "@/lib/services/reports";

export const metadata: Metadata = { title: "Ajustes" };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "configurada";
  }
}

export default async function AjustesPage() {
  const db = getDbConfig();
  const ai = getAiConfig();
  const storage = getStorageConfig();
  const auth = getAuthConfig();
  const status = await loadData(async (database) => {
    const [row] = await database.query<{ version: string }>("select max(version) as version from schema_migrations");
    const last = await getSetting<{ at: string }>(database, "ultimo_respaldo");
    return { schema: row?.version ?? null, lastBackup: last?.at ?? null, aiUsage: await aiUsageSummary(database) };
  });
  const actor = await getActorName();

  const items: { label: string; state: "ok" | "warn" | "error"; detail: string }[] = [
    {
      label: "Base de datos",
      state: !status.ok ? "error" : "ok",
      detail: !status.ok
        ? status.error.message
        : db.kind === "postgres"
          ? `PostgreSQL (${hostOf(db.url)}) · esquema ${status.data.schema}`
          : `PostgreSQL embebido local (${db.kind === "pglite" && db.dataDir ? "persistente en disco" : "en memoria"}) · solo para desarrollo`,
    },
    {
      label: "Clave de acceso",
      state: auth.mode === "clave" ? "ok" : auth.mode === "abierto-local" ? "warn" : "error",
      detail:
        auth.mode === "clave"
          ? "Configurada. Cada dispositivo queda habilitado 90 días; al cambiar la clave se cierran todas las sesiones."
          : auth.mode === "abierto-local"
            ? "Sin clave: solo permitido en desarrollo local."
            : "Falta CLAVE_CONSULTORIO: el acceso está bloqueado por seguridad.",
    },
    {
      label: "Inteligencia artificial",
      state: ai.enabled ? "ok" : "warn",
      detail: ai.enabled
        ? [
            `Activa con ${ai.providerName} · asistente: ${ai.assistantModel} · facturas: ${ai.invoiceModel}.`,
            ai.provider === "gemini"
              ? "El plan gratuito tiene un cupo chico por minuto y por día: si se agota, el asistente sigue en modo básico y las facturas se cargan a mano hasta que se renueve."
              : null,
            ai.privacyNote,
          ]
            .filter(Boolean)
            .join(" ")
        : ai.reason,
    },
    {
      label: "Archivos de facturas",
      state: storage.kind === "none" ? "warn" : "ok",
      detail:
        storage.kind === "blob"
          ? "Vercel Blob (almacenamiento privado)"
          : storage.kind === "local"
            ? "Carpeta local (desarrollo)"
            : storage.reason,
    },
  ];

  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Este dispositivo" description="Tu nombre aparece en el historial junto a cada movimiento que registrás." />
          <CardBody>
            <DeviceNameForm initial={actor ?? ""} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Estado del sistema" />
          <CardBody className="space-y-3">
            {items.map((i) => (
              <div key={i.label} className="flex gap-3">
                {i.state === "ok" ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Correcto" />
                ) : i.state === "warn" ? (
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-label="Atención" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-label="Error" />
                )}
                <div>
                  <p className="text-sm font-medium">{i.label}</p>
                  <p className="text-sm text-muted">{i.detail}</p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        {ai.enabled && status.ok && (
          <Card className="lg:col-span-2" id="uso-ia">
            <CardHeader
              title="Uso de la IA"
              description={`Hoy: ${status.data.aiUsage.today.requests} consultas a ${ai.providerName} · pico de ${status.data.aiUsage.today.peakPerMinute} en un mismo minuto · ${status.data.aiUsage.today.limited} rechazadas por límite`}
            />
            <CardBody className="space-y-3">
              {status.data.aiUsage.days.length === 0 ? (
                <p className="text-sm text-muted">Todavía no hay consultas registradas.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted">
                      <tr>
                        <th className="py-1.5 pr-3 font-medium">Día</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Consultas</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Pico por minuto</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Rechazadas por límite</th>
                        <th className="py-1.5 text-right font-medium">Otros errores</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.data.aiUsage.days.map((d) => (
                        <tr key={d.day} className="border-t border-line">
                          <td className="py-1.5 pr-3">{formatDate(d.day)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{d.requests}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{d.peakPerMinute}</td>
                          <td className={`py-1.5 pr-3 text-right tabular-nums ${d.limited > 0 ? "font-semibold text-amber-800" : ""}`}>{d.limited}</td>
                          <td className="py-1.5 text-right tabular-nums">{d.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted">
                Cada pedido al asistente usa normalmente 1 o 2 consultas; cada factura, 1. Las rechazadas por límite se responden con el modo básico.
                {ai.provider === "gemini" && " En noviembre de 2026, el plan gratuito de Gemini permitía 15 consultas por minuto para el modelo del asistente (Google puede cambiarlo)."}
                {status.data.aiUsage.lastLimitedAt && ` Último rechazo por límite: ${formatDateTime(status.data.aiUsage.lastLimitedAt)}.`}
              </p>
            </CardBody>
          </Card>
        )}

        <Card className="lg:col-span-2" id="respaldo">
          <CardHeader
            title="Respaldo y exportación"
            description={
              status.ok && status.data.lastBackup
                ? `Último respaldo descargado: ${formatDateTime(status.data.lastBackup)}`
                : "Todavía no se descargó ningún respaldo desde este sistema."
            }
          />
          <CardBody>
            <BackupPanel />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
