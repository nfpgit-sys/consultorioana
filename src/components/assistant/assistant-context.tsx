"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface AssistantContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  aiEnabled: boolean;
  /** Abre el asistente con un texto precargado (por ejemplo desde un botón "Preguntar"). */
  ask: (text: string) => void;
  pendingPrompt: string | null;
  consumePendingPrompt: () => string | null;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children, aiEnabled }: { children: ReactNode; aiEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ask = useCallback((text: string) => {
    setPendingPrompt(text);
    setOpen(true);
  }, []);

  const consumePendingPrompt = useCallback(() => {
    const p = pendingPrompt;
    setPendingPrompt(null);
    return p;
  }, [pendingPrompt]);

  const value = useMemo(
    () => ({ open, setOpen, aiEnabled, ask, pendingPrompt, consumePendingPrompt }),
    [open, aiEnabled, ask, pendingPrompt, consumePendingPrompt],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant debe usarse dentro de AssistantProvider");
  return ctx;
}
