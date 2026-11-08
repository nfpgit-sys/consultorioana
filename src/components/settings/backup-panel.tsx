"use client";

import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";

async function gzip(file: File): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

export function BackupPanel() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const restore = async () => {
    if (!file) return;
    setPending(true);
    setMessage(null);
    try {
      const compressed = await gzip(file);
      const res = await fetch("/api/respaldo", {
        method: "POST",
        headers: { "X-Confirmacion": "RESTAURAR", ...(compressed ? { "X-Comprimido": "gzip" } : {}), "Content-Type": "application/octet-stream" },
        body: compressed ?? file,
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; restored?: Record<string, number> };
      if (!res.ok || !data.ok) {
        setMessage({ tone: "error", text: data.error ?? "No se pudo restaurar." });
      } else {
        setMessage({ tone: "success", text: `Respaldo restaurado: ${data.restored?.products ?? 0} productos y ${data.restored?.stock_movements ?? 0} movimientos.` });
        toast.success("Respaldo restaurado.");
        setFile(null);
        setConfirmText("");
        router.refresh();
      }
    } catch {
      setMessage({ tone: "error", text: "No se pudo enviar el archivo. La base no se modificó." });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          El respaldo es un archivo JSON con todos los datos (productos, movimientos, compras, gastos, proveedores e historial). Guardalo fuera de la
          computadora del consultorio, por ejemplo en Google Drive. Las imágenes de facturas quedan en el almacenamiento de archivos.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/respaldo" className={buttonClass("primary")} onClick={() => setTimeout(() => router.refresh(), 2500)}>
            <Download className="h-5 w-5" /> Descargar respaldo
          </a>
          <a href="/api/exportar?tipo=todo" className={buttonClass("outline")}>
            <FileSpreadsheet className="h-5 w-5" /> Exportar todo a Excel
          </a>
        </div>
      </div>
      <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
        <p className="text-sm font-semibold text-rose-900">Restaurar un respaldo</p>
        <p className="text-sm text-rose-900/80">
          Reemplaza <strong>todos</strong> los datos actuales por los del archivo. Descargá antes un respaldo del estado actual. Si algo falla, no se modifica nada.
        </p>
        <Input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Archivo de respaldo" />
        <Field label='Escribí "RESTAURAR" para confirmar' htmlFor="rst">
          <Input id="rst" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </Field>
        <Button variant="danger" disabled={!file || confirmText !== "RESTAURAR" || pending} onClick={restore}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Restaurar
        </Button>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </div>
    </div>
  );
}
