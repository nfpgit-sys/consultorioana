import type { Queryable } from "@/lib/db/types";
import type { Warning } from "./types";

/**
 * Si el archivo de una factura (mismo hash) ya se registró como compra o gasto vigente desde
 * otro comprobante, devuelve una advertencia que exige confirmación. Funciona igual con o sin IA.
 */
export async function sameFileRegisteredWarning(q: Queryable, documentId: string | null | undefined): Promise<Warning | null> {
  if (!documentId) return null;
  const rows = await q.query<{ number: number; purchase_number: number | null; expense_number: number | null }>(
    `select distinct d.number, p.number as purchase_number, e.number as expense_number
       from document_files f
       join documents d on d.id = f.document_id
       left join purchases p on p.id = d.linked_purchase_id and p.status <> 'anulada'
       left join expenses e on e.id = d.linked_expense_id and e.status <> 'anulado'
      where f.sha256 in (select sha256 from document_files where document_id = $1)
        and d.id <> $1
        and (p.id is not null or e.id is not null)
      order by d.number`,
    [documentId],
  );
  if (!rows.length) return null;
  const where = rows
    .map((r) => `comprobante #${r.number} → ${r.purchase_number !== null ? `compra #${r.purchase_number}` : `gasto #${r.expense_number}`}`)
    .join(", ");
  return {
    code: "archivo_repetido",
    requiresAck: true,
    message: `Este mismo archivo ya se registró (${where}). ¿Es otra factura distinta?`,
  };
}
