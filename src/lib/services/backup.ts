import type { Database, Queryable } from "@/lib/db/types";
import { MIGRATIONS } from "@/lib/db/migrate";
import { type ActionContext, audit } from "./context";
import { DomainError } from "./errors";
import { setSetting } from "./reports";

/** Tablas incluidas en el respaldo, en orden de dependencias (padres primero). */
export const BACKUP_TABLES = [
  "app_settings",
  "suppliers",
  "products",
  "product_presentations",
  "product_aliases",
  "lots",
  "documents",
  "document_files",
  "operations",
  "purchases",
  "purchase_items",
  "expenses",
  "stock_movements",
  "audit_log",
] as const;

export interface BackupFile {
  app: "consultorIA";
  format: 1;
  schema: string;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportBackup(db: Database): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  const counts: Record<string, number> = {};
  // Lectura consistente de todas las tablas.
  await db.transaction(async (tx) => {
    await tx.query("set transaction isolation level repeatable read");
    for (const t of BACKUP_TABLES) {
      const rows = await tx.query<Record<string, unknown>>(`select * from ${t}`);
      tables[t] = rows;
      counts[t] = rows.length;
    }
  });
  await setSetting(db, "ultimo_respaldo", { at: new Date().toISOString() });
  return {
    app: "consultorIA",
    format: 1,
    schema: MIGRATIONS[MIGRATIONS.length - 1].version,
    exportedAt: new Date().toISOString(),
    counts,
    tables,
  };
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_identity: string;
}

async function columnsOf(q: Queryable, table: string): Promise<ColumnInfo[]> {
  return q.query<ColumnInfo>(
    `select column_name, data_type, is_identity from information_schema.columns
     where table_schema = current_schema() and table_name = $1 order by ordinal_position`,
    [table],
  );
}

export function validateBackup(data: unknown): BackupFile {
  const b = data as Partial<BackupFile>;
  if (!b || typeof b !== "object" || b.app !== "consultorIA" || b.format !== 1 || !b.tables || typeof b.tables !== "object") {
    throw new DomainError("respaldo_invalido", "El archivo no es un respaldo válido de consultorIA.");
  }
  if (!MIGRATIONS.some((m) => m.version === b.schema)) {
    throw new DomainError("respaldo_version", `El respaldo es de una versión del esquema desconocida (${String(b.schema)}).`);
  }
  for (const t of BACKUP_TABLES) {
    if (!Array.isArray(b.tables[t])) throw new DomainError("respaldo_incompleto", `El respaldo no contiene la tabla ${t}.`);
  }
  return b as BackupFile;
}

/**
 * Reemplaza TODOS los datos por los del respaldo, en una sola transacción:
 * si algo falla, la base queda exactamente como estaba.
 */
export async function restoreBackup(db: Database, raw: unknown, ctx: ActionContext): Promise<Record<string, number>> {
  const backup = validateBackup(raw);
  return db.transaction(async (tx) => {
    await tx.exec(`truncate table ${[...BACKUP_TABLES].reverse().join(", ")} restart identity cascade`);
    const restored: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      const columns = await columnsOf(tx, table);
      const allowed = new Map(columns.map((c) => [c.column_name, c]));
      const rows = backup.tables[table];
      const hasIdentity = columns.some((c) => c.is_identity === "YES");
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => allowed.has(k));
        if (keys.length === 0) continue;
        const values = keys.map((k) => {
          const v = row[k];
          const type = allowed.get(k)!.data_type;
          if (v !== null && (type === "jsonb" || type === "json")) return JSON.stringify(v);
          return v;
        });
        const placeholders = keys.map((_, i) => `$${i + 1}`);
        await tx.query(
          `insert into ${table} (${keys.map((k) => `"${k}"`).join(", ")}) ${hasIdentity ? "overriding system value" : ""} values (${placeholders.join(", ")})`,
          values,
        );
      }
      for (const c of columns.filter((col) => col.is_identity === "YES")) {
        await tx.query(
          `select setval(pg_get_serial_sequence($1, $2), coalesce((select max("${c.column_name}") from ${table}), 0) + 1, false)`,
          [table, c.column_name],
        );
      }
      restored[table] = rows.length;
    }
    await audit(tx, ctx, {
      entityType: "sistema",
      action: "restaurar_respaldo",
      details: { exportado: backup.exportedAt, filas: restored },
    });
    return restored;
  });
}
