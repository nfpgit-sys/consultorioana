"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/server/action";
import type { Warning } from "@/lib/services/types";

type AckField = "acknowledgeWarnings" | "acknowledgeSimilar";

export interface ConfirmableState {
  error?: string;
  code?: string;
  warnings?: Warning[];
  details?: Record<string, unknown>;
  needsAck?: boolean;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * Ejecuta una acción de servidor con:
 * - clave de idempotencia estable por intento (un doble clic o reintento no duplica);
 * - flujo de confirmación reforzada: si el servidor devuelve advertencias que requieren
 *   confirmación, se muestran y la persona decide si confirma igualmente.
 */
export function useConfirmableAction<V extends object, R>(
  action: (values: V) => Promise<ActionResult<R>>,
  opts: { onSuccess?: (data: R, message?: string) => void; ackField?: AckField } = {},
) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ConfirmableState>({});
  const keyRef = useRef<string>(newKey());
  const lastValues = useRef<V | null>(null);
  const ackField = opts.ackField ?? "acknowledgeWarnings";
  const onSuccess = opts.onSuccess;

  const submit = useCallback(
    (values: V, acknowledge = false) => {
      lastValues.current = values;
      startTransition(async () => {
        try {
          const res = await action({ ...values, idempotencyKey: keyRef.current, [ackField]: acknowledge } as V);
          if (res.ok) {
            setState({});
            keyRef.current = newKey();
            onSuccess?.(res.data, res.message);
          } else if (res.code === "requiere_confirmacion" || res.code === "producto_similar") {
            setState({ error: res.error, code: res.code, warnings: res.warnings, details: res.details, needsAck: true });
          } else {
            setState({ error: res.error, code: res.code, details: res.details });
          }
        } catch {
          setState({ error: "No se pudo contactar al servidor. Revisá la conexión y probá de nuevo; no se registró nada dos veces." });
        }
      });
    },
    [action, ackField, onSuccess],
  );

  const confirm = useCallback(() => {
    if (lastValues.current) submit(lastValues.current, true);
  }, [submit]);

  const reset = useCallback(() => {
    setState({});
    keyRef.current = newKey();
  }, []);

  return { submit, confirm, reset, pending, ...state };
}
