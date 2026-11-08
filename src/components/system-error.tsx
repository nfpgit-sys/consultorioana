import { DatabaseZap } from "lucide-react";
import type { SystemError } from "@/lib/server/load";
import { Card } from "./ui/card";

export function SystemErrorCard({ error }: { error: SystemError }) {
  return (
    <Card className="border-rose-200">
      <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <DatabaseZap className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <h2 className="font-semibold text-ink">{error.title}</h2>
          <p className="mt-1 text-sm text-muted">{error.message}</p>
          {error.kind === "sin_base" && (
            <p className="mt-2 text-sm text-muted">
              El detalle de la configuración está en <strong>Ajustes → Estado del sistema</strong> y en el README del proyecto.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
