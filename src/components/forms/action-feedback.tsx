"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ConfirmableState } from "./use-confirmable-action";

/** Muestra errores y advertencias de una acción, con el botón de confirmación reforzada. */
export function ActionFeedback({
  state,
  onConfirm,
  pending,
  confirmLabel = "Sí, confirmar igualmente",
}: {
  state: ConfirmableState;
  onConfirm: () => void;
  pending?: boolean;
  confirmLabel?: string;
}) {
  if (state.needsAck) {
    const blocking = state.warnings?.filter((w) => w.requiresAck) ?? [];
    const info = state.warnings?.filter((w) => !w.requiresAck) ?? [];
    return (
      <Alert
        tone="warning"
        title={state.code === "producto_similar" ? "¿Es un producto distinto?" : "Revisá antes de confirmar"}
        action={
          <Button variant="warning" size="sm" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        }
      >
        {state.code === "producto_similar" ? (
          <p>{state.error}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-4">
            {blocking.map((w) => (
              <li key={w.code + w.message}>{w.message}</li>
            ))}
            {info.map((w) => (
              <li key={w.code + w.message} className="text-amber-800/80">
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </Alert>
    );
  }
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  return null;
}
