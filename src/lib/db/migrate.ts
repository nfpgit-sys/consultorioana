import type { Database } from "./types";
import { sql as m0001 } from "./migrations/0001_esquema_inicial";
import { sql as m0002 } from "./migrations/0002_uso_ia";
import { sql as m0003 } from "./migrations/0003_dispositivos";
import { sql as m0004 } from "./migrations/0004_rls_migraciones";

export interface Migration {
  version: string;
  sql: string;
}

/** Lista ordenada de migraciones. Nunca se edita una migración ya publicada: se agrega otra. */
export const MIGRATIONS: Migration[] = [
  { version: "0001_esquema_inicial", sql: m0001 },
  { version: "0002_uso_ia", sql: m0002 },
  { version: "0003_dispositivos", sql: m0003 },
  { version: "0004_rls_migraciones", sql: m0004 },
];

/** Clave del lock consultivo que serializa migraciones entre instancias concurrentes. */
const MIGRATION_LOCK_KEY = 727_274_101;

export interface MigrationReport {
  applied: string[];
  current: string;
}

export async function runMigrations(db: Database): Promise<MigrationReport> {
  // Camino rápido: si la tabla existe y están todas aplicadas, no se toma ningún lock.
  try {
    const rows = await db.query<{ version: string }>("select version from schema_migrations");
    const done = new Set(rows.map((r) => r.version));
    if (MIGRATIONS.every((m) => done.has(m.version))) {
      return { applied: [], current: MIGRATIONS[MIGRATIONS.length - 1].version };
    }
  } catch {
    // La tabla todavía no existe: se crea dentro de la transacción.
  }

  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await tx.exec(
      "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
    );
    const rows = await tx.query<{ version: string }>("select version from schema_migrations");
    const done = new Set(rows.map((r) => r.version));
    const applied: string[] = [];
    for (const migration of MIGRATIONS) {
      if (done.has(migration.version)) continue;
      await tx.exec(migration.sql);
      await tx.query("insert into schema_migrations (version) values ($1)", [migration.version]);
      applied.push(migration.version);
    }
    return { applied, current: MIGRATIONS[MIGRATIONS.length - 1].version };
  });
}
