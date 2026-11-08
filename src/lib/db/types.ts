export type Row = Record<string, unknown>;

/** Interfaz mínima común a PGlite (desarrollo) y node-postgres (producción). */
export interface Queryable {
  /** Ejecuta una sentencia parametrizada ($1, $2, ...) y devuelve las filas. */
  query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Ejecuta uno o más statements sin parámetros (migraciones). */
  exec(text: string): Promise<void>;
}

export type DatabaseKind = "pglite" | "postgres";

export interface Database extends Queryable {
  readonly kind: DatabaseKind;
  /** Ejecuta `fn` dentro de una transacción. Si `fn` lanza, se revierte todo. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Conversión del texto de timestamptz de Postgres (sesión en UTC) a ISO 8601. */
export function pgTimestampToIso(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/.exec(raw);
  if (!m) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida devuelta por la base: ${raw}`);
    return d.toISOString();
  }
  const [, date, time, hours, minutes] = m;
  return new Date(`${date}T${time}${hours}:${minutes ?? "00"}`).toISOString();
}

/**
 * Parsers compartidos para que ambos drivers devuelvan los mismos tipos:
 * - numeric -> string (se convierte a number en los mapeadores, sin perder precisión en SQL)
 * - date -> 'YYYY-MM-DD' (sin corrimientos de zona horaria)
 * - timestamptz -> ISO string
 * - int8 -> number (contadores; los valores de la app están lejos de 2^53)
 */
export const TYPE_PARSERS: Record<number, (value: string) => unknown> = {
  20: (v) => Number(v), // int8
  1700: (v) => v, // numeric
  1082: (v) => v, // date
  1184: (v) => pgTimestampToIso(v), // timestamptz
  1114: (v) => v, // timestamp sin zona (no se usa, se deja tal cual)
};
