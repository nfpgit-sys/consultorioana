import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";
import { getStorageConfig } from "@/lib/config";

/**
 * Almacenamiento de archivos de facturas:
 * - Vercel Blob en modo privado (producción): solo el servidor puede leerlos con su token.
 * - Carpeta local (desarrollo).
 * - Sin almacenamiento: la factura se analiza pero no se guarda copia (se avisa en la interfaz).
 */
export interface StoredFile {
  storage: "blob" | "local" | "none";
  key: string | null;
}

function safeName(name: string): string {
  return name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80) || "archivo";
}

export async function saveFile(documentId: string, fileName: string, contentType: string, data: Buffer): Promise<StoredFile> {
  const cfg = getStorageConfig();
  const relative = `facturas/${documentId}/${Date.now()}-${safeName(fileName)}`;
  if (cfg.kind === "blob") {
    const result = await put(relative, data, { access: "private", token: cfg.token, contentType, addRandomSuffix: true });
    return { storage: "blob", key: result.pathname };
  }
  if (cfg.kind === "local") {
    const full = path.join(cfg.dir, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return { storage: "local", key: relative };
  }
  return { storage: "none", key: null };
}

export async function readStoredFile(storage: string, key: string | null): Promise<Buffer | null> {
  if (!key) return null;
  const cfg = getStorageConfig();
  if (storage === "blob" && cfg.kind === "blob") {
    const result = await get(key, { access: "private", token: cfg.token });
    if (!result?.stream) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  if (storage === "local" && cfg.kind === "local") {
    const full = path.resolve(cfg.dir, key);
    if (!full.startsWith(path.resolve(cfg.dir) + path.sep)) return null;
    try {
      return await readFile(full);
    } catch {
      return null;
    }
  }
  return null;
}
