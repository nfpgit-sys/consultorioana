import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Queryable, Row } from "./types";
import { TYPE_PARSERS } from "./types";

/**
 * Base PostgreSQL embebida (WASM). Se usa en desarrollo local y en tests.
 * Con `dataDir` los datos persisten en disco; sin él, viven en memoria.
 */
export async function createPgliteDatabase(dataDir: string | null): Promise<Database> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = await PGlite.create(dataDir ?? undefined, { parsers: TYPE_PARSERS });
  await pg.exec("SET TIME ZONE 'UTC';");

  const wrap = (q: Pick<PGlite, "query" | "exec">): Queryable => ({
    async query<T = Row>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const res = await q.query(text, params as unknown[]);
      return res.rows as T[];
    },
    async exec(text: string) {
      await q.exec(text);
    },
  });

  const base = wrap(pg);
  return {
    kind: "pglite",
    query: base.query,
    exec: base.exec,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => fn(wrap(tx)));
    },
    async close() {
      await pg.close();
    },
  };
}
