import { createHash } from "node:crypto";
import type { Database, Queryable } from "@/lib/db/types";
import { coerceExtraction, type InvoiceExtraction } from "@/lib/invoices/schema";
import { type ActionContext, audit, withOperation } from "./context";
import { DomainError, NotFoundError } from "./errors";
import { uuid } from "./validation";

export type DocumentStatus = "pendiente" | "analizado" | "error" | "registrado" | "descartado";

export interface DocumentFile {
  id: string;
  position: number;
  storage: "blob" | "local" | "none";
  storageKey: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface InvoiceDocument {
  id: string;
  number: number;
  status: DocumentStatus;
  extraction: InvoiceExtraction | null;
  extractionModel: string | null;
  extractionError: string | null;
  extractedAt: string | null;
  linkedPurchaseId: string | null;
  linkedExpenseId: string | null;
  discardedReason: string | null;
  actor: string | null;
  createdAt: string;
  files: DocumentFile[];
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function createDocument(
  db: Database,
  files: { fileName: string; mimeType: string; sizeBytes: number; sha256: string; storage: "blob" | "local" | "none"; storageKey: string | null }[],
  ctx: ActionContext,
  documentId: string,
): Promise<{ id: string; number: number }> {
  return db.transaction(async (tx) => {
    const [doc] = await tx.query<{ id: string; number: number }>(
      "insert into documents (id, status, actor) values ($1, 'pendiente', $2) returning id, number",
      [documentId, ctx.actor ?? null],
    );
    for (const [i, f] of files.entries()) {
      await tx.query(
        `insert into document_files (document_id, position, storage, storage_key, file_name, mime_type, size_bytes, sha256)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [doc.id, i + 1, f.storage, f.storageKey, f.fileName.slice(0, 200), f.mimeType, f.sizeBytes, f.sha256],
      );
    }
    await withOperation(tx, { ...ctx, idempotencyKey: null }, { kind: "subir_factura", summary: `Factura #${doc.number}` }, async (operationId) => {
      await audit(tx, ctx, { entityType: "factura", entityId: doc.id, action: "subir", details: { archivos: files.length }, operationId });
      return null;
    });
    return doc;
  });
}

export async function saveExtraction(q: Queryable, id: string, result: { data: InvoiceExtraction; model: string } | { error: string }) {
  if ("error" in result) {
    await q.query("update documents set status = 'error', extraction_error = $2, updated_at = now() where id = $1", [id, result.error.slice(0, 500)]);
  } else {
    await q.query(
      `update documents set status = 'analizado', extraction = $2, extraction_model = $3, extraction_error = null, extracted_at = now(), updated_at = now()
       where id = $1`,
      [id, JSON.stringify(result.data), result.model],
    );
  }
}

interface DocRow {
  id: string;
  number: number;
  status: DocumentStatus;
  /** JSON guardado: puede tener el formato de una versión anterior del lector. */
  extraction: unknown;
  extraction_model: string | null;
  extraction_error: string | null;
  extracted_at: string | null;
  linked_purchase_id: string | null;
  linked_expense_id: string | null;
  discarded_reason: string | null;
  actor: string | null;
  created_at: string;
}

async function filesFor(q: Queryable, ids: string[]): Promise<Map<string, DocumentFile[]>> {
  const map = new Map<string, DocumentFile[]>();
  if (!ids.length) return map;
  const rows = await q.query<{
    id: string;
    document_id: string;
    position: number;
    storage: DocumentFile["storage"];
    storage_key: string | null;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
  }>("select * from document_files where document_id = any($1::uuid[]) order by position", [ids]);
  for (const r of rows) {
    map.set(r.document_id, [
      ...(map.get(r.document_id) ?? []),
      {
        id: r.id,
        position: r.position,
        storage: r.storage,
        storageKey: r.storage_key,
        fileName: r.file_name,
        mimeType: r.mime_type,
        sizeBytes: r.size_bytes,
        sha256: r.sha256,
      },
    ]);
  }
  return map;
}

function mapDoc(r: DocRow, files: DocumentFile[]): InvoiceDocument {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    // Se normaliza al leer: las lecturas guardadas con versiones anteriores siguen funcionando.
    extraction: r.extraction ? coerceExtraction(typeof r.extraction === "string" ? JSON.parse(r.extraction) : r.extraction) : null,
    extractionModel: r.extraction_model,
    extractionError: r.extraction_error,
    extractedAt: r.extracted_at,
    linkedPurchaseId: r.linked_purchase_id,
    linkedExpenseId: r.linked_expense_id,
    discardedReason: r.discarded_reason,
    actor: r.actor,
    createdAt: r.created_at,
    files,
  };
}

export async function getDocument(q: Queryable, id: string): Promise<InvoiceDocument | null> {
  if (!uuid.safeParse(id).success) return null;
  const rows = await q.query<DocRow>("select * from documents where id = $1", [id]);
  if (!rows[0]) return null;
  return mapDoc(rows[0], (await filesFor(q, [id])).get(id) ?? []);
}

export async function listDocuments(q: Queryable, limit = 50): Promise<InvoiceDocument[]> {
  const rows = await q.query<DocRow>(`select * from documents order by created_at desc limit ${Math.min(limit, 200)}`);
  const files = await filesFor(q, rows.map((r) => r.id));
  return rows.map((r) => mapDoc(r, files.get(r.id) ?? []));
}

/** Otros comprobantes que contienen exactamente el mismo archivo (mismo hash). */
export async function findSameFiles(q: Queryable, documentId: string): Promise<{ documentId: string; number: number; status: DocumentStatus }[]> {
  return (
    await q.query<{ document_id: string; number: number; status: DocumentStatus }>(
      `select distinct d.id as document_id, d.number, d.status
       from document_files f join documents d on d.id = f.document_id
       where f.sha256 in (select sha256 from document_files where document_id = $1) and d.id <> $1
       order by d.number`,
      [documentId],
    )
  ).map((r) => ({ documentId: r.document_id, number: r.number, status: r.status }));
}

export async function discardDocument(db: Database, id: string, reason: string, ctx: ActionContext) {
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ status: DocumentStatus; number: number }>("select status, number from documents where id = $1 for update", [id]);
    if (!row) throw new NotFoundError("La factura");
    if (row.status === "registrado") {
      throw new DomainError("estado_invalido", "La factura ya se registró. Para corregirla, anulá la compra o el gasto asociado.");
    }
    await tx.query("update documents set status = 'descartado', discarded_reason = $2, updated_at = now() where id = $1", [id, reason.trim() || "Descartada"]);
    await withOperation(tx, { ...ctx, idempotencyKey: null }, { kind: "descartar_factura" }, async (operationId) => {
      await audit(tx, ctx, { entityType: "factura", entityId: id, action: "descartar", details: { numero: row.number, motivo: reason }, operationId });
      return null;
    });
    return { documentId: id };
  });
}
