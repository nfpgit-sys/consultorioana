"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setActorNameAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

export function DeviceNameForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await setActorNameAction(name);
          if (res.ok) {
            toast.success(res.message ?? "Guardado.");
            router.refresh();
          } else toast.error(res.error);
        });
      }}
    >
      <Field label="Tu nombre" htmlFor="actor" className="flex-1">
        <Input id="actor" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ej.: Dra. Ana" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar
      </Button>
    </form>
  );
}
