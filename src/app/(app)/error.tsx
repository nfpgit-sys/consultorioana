"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto max-w-lg p-6 text-center">
      <h1 className="text-lg font-semibold">Algo no salió bien</h1>
      <p className="mt-2 text-sm text-muted">
        No se pudo mostrar esta sección. Tus datos no se modificaron. Probá de nuevo; si el problema sigue, revisá <strong>Ajustes → Estado del sistema</strong>.
      </p>
      <Button className="mt-4" onClick={reset}>
        <RefreshCw className="h-4 w-4" /> Reintentar
      </Button>
    </Card>
  );
}
