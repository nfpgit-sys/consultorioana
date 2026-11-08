import "server-only";
import { getDbConfig } from "@/lib/config";
import { runMigrations } from "./migrate";
import type { Database } from "./types";

export type { Database, Queryable, Row } from "./types";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "La base de datos no está configurada. Falta la variable DATABASE_URL en el entorno de producción.",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

type GlobalWithDb = typeof globalThis & { __consultoriaDb?: Promise<Database> };
const g = globalThis as GlobalWithDb;

async function init(): Promise<Database> {
  const cfg = getDbConfig();
  let db: Database;
  if (cfg.kind === "missing") throw new DatabaseNotConfiguredError();
  if (cfg.kind === "postgres") {
    const { createPostgresDatabase } = await import("./postgres");
    db = createPostgresDatabase(cfg.url);
  } else {
    const { createPgliteDatabase } = await import("./pglite");
    db = await createPgliteDatabase(cfg.dataDir);
  }
  await runMigrations(db);
  return db;
}

/**
 * Devuelve la conexión compartida (una por proceso; sobrevive al recargado en caliente
 * de `next dev`, para no abrir dos veces la misma base embebida).
 */
export function getDb(): Promise<Database> {
  if (!g.__consultoriaDb) {
    g.__consultoriaDb = init().catch((err) => {
      g.__consultoriaDb = undefined;
      throw err;
    });
  }
  return g.__consultoriaDb;
}

/** Solo para tests: reemplaza la conexión compartida. */
export function setDbForTesting(db: Database | undefined) {
  g.__consultoriaDb = db ? Promise.resolve(db) : undefined;
}
