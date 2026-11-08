"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Tipos mínimos de la Web Speech API (no están en lib.dom de TypeScript). */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type Ctor = new () => SpeechRecognitionLike;

function getCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "No hay permiso para usar el micrófono. Habilitalo en el navegador.",
  "service-not-allowed": "El navegador no permite el dictado en este momento.",
  "no-speech": "No se escuchó nada. Probá de nuevo, más cerca del micrófono.",
  "audio-capture": "No se encontró un micrófono.",
  network: "El dictado necesita conexión a internet.",
};

/**
 * Dictado por voz con la API del navegador (es-AR). El texto reconocido se muestra en el
 * campo de entrada para revisarlo antes de enviarlo: nunca se envía solo.
 */
export function useSpeech(onText: (text: string, isFinal: boolean) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => setSupported(getCtor() !== null), []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const C = getCtor();
    if (!C) {
      setError("Tu navegador no permite dictado. En el celular podés usar el micrófono del teclado.");
      return;
    }
    setError(null);
    const rec = new C();
    rec.lang = "es-AR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onTextRef.current((finalText + interim).trim(), interim === "");
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted") setError(ERRORS[e.error] ?? "No se pudo usar el dictado.");
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError("No se pudo iniciar el dictado.");
    }
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, error, start, stop, clearError: () => setError(null) };
}
