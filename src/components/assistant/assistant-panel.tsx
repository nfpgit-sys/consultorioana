"use client";

import { Loader2, Mic, MicOff, RotateCcw, SendHorizontal, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import type { AssistantReply, Proposal } from "@/lib/agent/types";
import { useAssistant } from "./assistant-context";
import { ProposalCard, type ProposalStatus } from "./proposal-card";
import { useSpeech } from "./use-speech";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "texto" | "voz";
  proposals?: Proposal[];
  notice?: string;
  mode?: "ia" | "basico";
  error?: boolean;
}

const STORAGE_KEY = "consultoria:asistente:v1";

const SUGGESTIONS = [
  "¿Qué productos están por agotarse?",
  "Hoy gasté 3 jeringas",
  "¿Cuántos guantes quedan?",
  "Mostrame cuánto gastamos este mes",
];

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function statusText(s: ProposalStatus | undefined): string {
  if (!s || s.state === "pendiente") return "pendiente de confirmación";
  if (s.state === "confirmada") return `confirmada y registrada (${s.detail})`;
  if (s.state === "cancelada") return "cancelada por la persona (no se registró)";
  return "registrada y luego deshecha";
}

/** Historial que se envía al servidor: texto + estado de cada propuesta, para que el modelo sepa qué pasó. */
function toHistory(messages: ChatMessage[], statuses: Record<string, ProposalStatus>) {
  return messages
    .filter((m) => !m.error)
    .map((m) => {
      if (m.role === "user") return { role: "user" as const, content: m.content };
      const extra = (m.proposals ?? []).map((p) => `[Propuesta "${p.title}": ${p.summary ?? ""} · estado: ${statusText(statuses[p.id])}]`).join("\n");
      return { role: "assistant" as const, content: [m.content, extra].filter(Boolean).join("\n") };
    })
    .slice(-16);
}

export function AssistantPanel({ voiceHint }: { voiceHint: string | null }) {
  const { open, setOpen, aiEnabled, pendingPrompt, consumePendingPrompt } = useAssistant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ProposalStatus>>({});
  const [input, setInput] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef(false);

  // Conversación persistida en la pestaña (sessionStorage).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as { messages: ChatMessage[]; statuses: Record<string, ProposalStatus> };
        setMessages(data.messages ?? []);
        setStatuses(data.statuses ?? {});
      }
    } catch {
      // sin almacenamiento disponible: se empieza de cero
    }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: messages.slice(-40), statuses }));
    } catch {
      // ignorado
    }
  }, [messages, statuses]);

  useEffect(() => {
    if (open && pendingPrompt) {
      const p = consumePendingPrompt();
      if (p) {
        setInput(p);
        setFromVoice(false);
      }
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, pendingPrompt, consumePendingPrompt]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const speech = useSpeech(
    useCallback((text: string) => {
      setInput(text);
      setFromVoice(true);
    }, []),
  );

  const send = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text || sending) return;
    if (speech.listening) speech.stop();
    const userMsg: ChatMessage = { id: uid(), role: "user", content: text, source: fromVoice ? "voz" : "texto" };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setFromVoice(false);
    setSending(true);
    try {
      const res = await fetch("/api/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toHistory(next, statuses) }),
      });
      const data = (await res.json()) as AssistantReply & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Error del asistente");
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", content: data.reply, proposals: data.proposals, notice: data.notice, mode: data.mode, source: userMsg.source },
      ]);
      setStatuses((s) => ({ ...s, ...Object.fromEntries(data.proposals.map((p) => [p.id, { state: "pendiente" } as ProposalStatus])) }));
    } catch (err) {
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", content: err instanceof Error ? err.message : "No se pudo contactar al asistente. No se registró nada.", error: true },
      ]);
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setStatuses({});
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignorado
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/30 lg:bg-black/20" aria-label="Cerrar asistente" onClick={() => setOpen(false)} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Asistente"
        className="relative flex h-dvh w-full flex-col bg-canvas shadow-[var(--shadow-float)] sm:max-w-md lg:max-w-[440px]"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-white">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="font-semibold leading-tight">Asistente</p>
              <p className="text-xs text-muted">{aiEnabled ? "Con IA · nada se registra sin tu confirmación" : "Modo básico (sin IA) · confirmás cada operación"}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button type="button" onClick={reset} className="rounded-xl p-2 text-muted hover:bg-black/5" aria-label="Nueva conversación" title="Nueva conversación">
                <RotateCcw className="h-5 w-5" />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 text-muted hover:bg-black/5" aria-label="Cerrar">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="space-y-3 pt-4">
              <p className="text-center text-sm text-muted">Escribí o dictá lo que necesitás. Por ejemplo:</p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-2xl border border-line bg-white px-3.5 py-2.5 text-left text-sm hover:border-brand-300 hover:bg-brand-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
              {!aiEnabled && (
                <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                  La IA no está configurada: el asistente entiende frases simples como las de arriba. Con la IA activada entiende pedidos más libres y conversa para aclarar dudas.
                </p>
              )}
              {voiceHint && <p className="text-xs text-muted">{voiceHint}</p>}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[0.95rem] whitespace-pre-line",
                  m.role === "user" ? "rounded-br-md bg-brand-600 text-white" : m.error ? "rounded-bl-md bg-rose-50 text-rose-900" : "rounded-bl-md bg-white text-ink shadow-[var(--shadow-card)]",
                )}
              >
                {m.content}
                {m.role === "user" && m.source === "voz" && (
                  <span className="mt-1 flex items-center gap-1 text-[0.7rem] text-white/75">
                    <Mic className="h-3 w-3" /> dictado
                  </span>
                )}
              </div>
              {m.notice && <p className="mt-1 max-w-[90%] text-xs text-amber-800">{m.notice}</p>}
              {m.role === "assistant" && m.mode === "basico" && aiEnabled && !m.notice && (
                <Badge tone="warning" className="mt-1">
                  Modo básico
                </Badge>
              )}
              {m.proposals?.map((p) => (
                <div key={p.id} className="w-full max-w-[95%]">
                  <ProposalCard
                    proposal={p}
                    status={statuses[p.id] ?? { state: "pendiente" }}
                    source={m.source === "voz" ? "voz" : "texto"}
                    onStatus={(s) => setStatuses((prev) => ({ ...prev, [p.id]: s }))}
                  />
                </div>
              ))}
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Pensando…
            </div>
          )}
        </div>

        <footer className="safe-bottom border-t border-line bg-white px-3 py-3">
          {speech.error && (
            <p className="mb-2 flex items-start justify-between gap-2 text-xs text-rose-700">
              {speech.error}
              <button type="button" onClick={speech.clearError} aria-label="Cerrar aviso">
                <X className="h-3.5 w-3.5" />
              </button>
            </p>
          )}
          {speech.listening && <p className="mb-2 text-xs font-medium text-brand-700">Escuchando… hablá y después revisá el texto antes de enviarlo.</p>}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <button
              type="button"
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
                speech.listening ? "animate-pulse-ring border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-slate-600 hover:bg-slate-50",
                !speech.supported && "opacity-60",
              )}
              aria-label={speech.listening ? "Detener dictado" : "Dictar por voz"}
              title={speech.supported ? "Dictar por voz" : "Tu navegador no permite dictado"}
            >
              {speech.supported ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (!e.target.value) setFromVoice(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="Ej.: hoy gasté 3 jeringas"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-white px-3.5 py-2.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none"
              aria-label="Mensaje para el asistente"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white disabled:opacity-40"
              aria-label="Enviar"
            >
              <SendHorizontal className="h-5 w-5" />
            </button>
          </form>
        </footer>
      </section>
    </div>
  );
}
