"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "./cn";

interface ToastItem {
  id: number;
  tone: "success" | "error";
  message: string;
}

let items: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: ToastItem["tone"], message: string) {
  const id = ++counter;
  items = [...items, { id, tone, message }].slice(-3);
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, tone === "error" ? 6000 : 3500);
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
};

const EMPTY: ToastItem[] = [];

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => EMPTY,
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-[var(--shadow-float)]",
            t.tone === "success" ? "bg-ink" : "bg-rose-700",
          )}
        >
          {t.tone === "success" ? <CheckCircle2 className="h-5 w-5 text-brand-300" /> : <XCircle className="h-5 w-5" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}
