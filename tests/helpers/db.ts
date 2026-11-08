import { randomUUID } from "node:crypto";
import pg from "pg";
import { runMigrations } from "@/lib/db/migrate";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { createPostgresDatabase } from "@/lib/db/postgres";
import type { Database } from "@/lib/db/types";
import type { ActionContext } from "@/lib/services/context";

export const usingPostgres = () => process.env.TEST_DB === "postgres";

/** Base nueva y vacía con el esquema aplicado: PGlite en memoria o una base en el PostgreSQL temporal. */
export async function createTestDb(): Promise<Database> {
  if (usingPostgres()) {
    const adminUrl = process.env.TEST_PG_ADMIN_URL;
    if (!adminUrl) throw new Error("TEST_PG_ADMIN_URL no está definido (globalSetup)");
    const name = `t_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    const db = createPostgresDatabase(adminUrl.replace(/\/postgres$/, `/${name}`));
    await runMigrations(db);
    return db;
  }
  const db = await createPgliteDatabase(null);
  await runMigrations(db);
  return db;
}

export const manual: ActionContext = { source: "manual", actor: "Test" };
export const texto = (key?: string): ActionContext => ({ source: "texto", actor: "Test", idempotencyKey: key ?? null });
