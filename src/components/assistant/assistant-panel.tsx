"use client";

import { useAssistant } from "./assistant-context";

/** Panel del asistente (se completa en la etapa del agente). */
export function AssistantPanel({ voiceHint }: { voiceHint: string | null }) {
  const { open, setOpen } = useAssistant();
  void voiceHint;
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
      <div className="h-full w-full max-w-md bg-white p-6" onClick={(e) => e.stopPropagation()}>
        Asistente
      </div>
    </div>
  );
}
