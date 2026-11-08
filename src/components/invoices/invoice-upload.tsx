"use client";

import { Camera, FileUp, Loader2, ScanText, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Picked {
  key: string;
  file: File;
  preview: string | null;
}

const MAX_SIDE = 2000;

/** Comprime fotos en el navegador (JPEG, lado mayor 2000 px) para subir rápido y bajar costos. */
async function compressImage(file: File): Promise<File> {
  // Toda imagen (también GIF, que la IA no lee) se convierte a JPEG liviano antes de subirla.
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`No se pudo leer la imagen «${file.name}». Probá sacar la foto en formato JPG.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // Fondo blanco: en JPEG las zonas transparentes (PNG/GIF) quedarían negras.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen."))), "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

export function InvoiceUpload({ aiEnabled, privacyNote = null }: { aiEnabled: boolean; privacyNote?: string | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [stage, setStage] = useState<"idle" | "procesando" | "subiendo" | "leyendo">("idle");
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const next = Array.from(list).map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setPicked((p) => [...p, ...next].slice(0, 6));
  };

  const submit = async () => {
    if (!picked.length) return;
    setError(null);
    try {
      setStage("procesando");
      const files = await Promise.all(picked.map((p) => compressImage(p.file)));
      const form = new FormData();
      for (const f of files) form.append("archivos", f);
      setStage("subiendo");
      const timer = setTimeout(() => setStage("leyendo"), 1200);
      const res = await fetch("/api/facturas", { method: "POST", body: form });
      clearTimeout(timer);
      const data = (await res.json().catch(() => ({}))) as { documentId?: string; error?: string };
      if (!res.ok || !data.documentId) throw new Error(data.error ?? "No se pudo subir la factura.");
      router.push(`/facturas/${data.documentId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la factura.");
      setStage("idle");
    }
  };

  const busy = stage !== "idle";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 px-4 py-6 text-brand-800 hover:bg-brand-50 disabled:opacity-50"
        >
          <Camera className="h-8 w-8" aria-hidden />
          <span className="font-medium">Sacar foto</span>
          <span className="text-xs text-brand-800/70">Una foto por página, con buena luz y sin cortes</span>
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line bg-white px-4 py-6 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <FileUp className="h-8 w-8" aria-hidden />
          <span className="font-medium">Subir archivo</span>
          <span className="text-xs text-muted">PDF o imágenes (JPG, PNG, WEBP)</span>
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {picked.length > 0 && (
        <div className="space-y-3">
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {picked.map((p) => (
              <li key={p.key} className="relative overflow-hidden rounded-xl border border-line bg-white">
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt={p.file.name} className="h-24 w-full object-cover" />
                ) : (
                  <div className="flex h-24 items-center justify-center text-xs text-muted">PDF</div>
                )}
                <p className="truncate px-1.5 py-1 text-[0.7rem] text-muted">{p.file.name}</p>
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setPicked((list) => list.filter((x) => x.key !== p.key))}
                    className="absolute top-1 right-1 rounded-lg bg-white/90 p-1 text-slate-600"
                    aria-label={`Quitar ${p.file.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Button size="lg" className="w-full sm:w-auto" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanText className="h-5 w-5" />}
            {stage === "procesando"
              ? "Preparando imágenes…"
              : stage === "subiendo"
                ? "Subiendo…"
                : stage === "leyendo"
                  ? aiEnabled
                    ? "Leyendo la factura con IA (puede tardar hasta un minuto)…"
                    : "Guardando…"
                  : aiEnabled
                    ? "Analizar factura"
                    : "Guardar y cargar datos a mano"}
          </Button>
        </div>
      )}
      {!aiEnabled && (
        <Alert tone="warning" title="Lectura automática desactivada">
          Falta configurar la IA (GEMINI_API_KEY). Igual podés guardar el comprobante y cargar sus datos a mano en la revisión.
        </Alert>
      )}
      {aiEnabled && privacyNote && <p className="text-xs text-muted">{privacyNote} Revisá que el comprobante no tenga nombres de pacientes (por ejemplo, órdenes de laboratorio).</p>}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
