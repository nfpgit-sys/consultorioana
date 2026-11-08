"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "./assistant-context";

export function AskAssistantButton({ prompt, label, variant = "secondary" }: { prompt: string; label: string; variant?: "secondary" | "outline" | "primary" }) {
  const { ask } = useAssistant();
  return (
    <Button variant={variant} onClick={() => ask(prompt)}>
      <Sparkles className="h-5 w-5" /> {label}
    </Button>
  );
}
