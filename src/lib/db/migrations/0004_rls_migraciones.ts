/** La tabla interna de versiones del esquema también queda con RLS (sin políticas públicas). */
export const sql = `
alter table schema_migrations enable row level security;
`;
