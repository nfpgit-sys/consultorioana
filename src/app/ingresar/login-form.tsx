"use client";

import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ingresar, type LoginState } from "./actions";

export function LoginForm({ next, needsClave, defaultName }: { next: string; needsClave: boolean; defaultName: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(ingresar, {});
  const [show, setShow] = useState(false);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="siguiente" value={next} />
      {needsClave && (
        <Field label="Clave del consultorio" htmlFor="clave">
          <div className="relative">
            <Input
              id="clave"
              name="clave"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              autoFocus
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted hover:text-ink"
              aria-label={show ? "Ocultar clave" : "Mostrar clave"}
            >
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </Field>
      )}
      <Field label="Tu nombre" htmlFor="nombre" optional hint="Aparece en el historial para saber quién registró cada movimiento.">
        <Input id="nombre" name="nombre" autoComplete="name" maxLength={40} defaultValue={defaultName} placeholder="Ej.: Dra. Ana" />
      </Field>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <LockKeyhole className="h-5 w-5" />}
        Ingresar
      </Button>
      {needsClave && <p className="text-center text-xs text-muted">Este dispositivo quedará habilitado durante 90 días.</p>}
    </form>
  );
}
