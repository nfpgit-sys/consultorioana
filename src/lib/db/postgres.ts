import pg from "pg";
import type { Database, Queryable, Row } from "./types";
import { TYPE_PARSERS } from "./types";

const customTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    const parser = TYPE_PARSERS[oid];
    if (parser && (format === undefined || format === "text")) return parser;
    return pg.types.getTypeParser(oid, format);
  },
};

/** PostgreSQL real (Neon, Supabase u otro) mediante node-postgres. */
export function createPostgresDatabase(connectionString: string): Database {
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    types: customTypes as pg.CustomTypesConfig,
  });
  // No se depende de la zona horaria de la sesión: las fechas se convierten siempre con
  // "at time zone 'America/Argentina/Buenos_Aires'" y el parser acepta cualquier desfasaje.
  // Un error en un cliente inactivo no debe tumbar el proceso.
  pool.on("error", (err) => {
    console.error("[db] error en conexión inactiva:", err.message);
  });

  const wrapClient = (client: pg.PoolClient): Queryable => ({
    async query<T = Row>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const res = await client.query(text, params as unknown[]);
      return res.rows as T[];
    },
    async exec(text: string) {
      await client.query(text);
    },
  });

  return {
    kind: "postgres",
    async query<T = Row>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      const res = await pool.query(text, params as unknown[]);
      return res.rows as T[];
    },
    async exec(text: string) {
      await pool.query(text);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrapClient(client));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
