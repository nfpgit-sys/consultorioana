/**
 * Uso de la IA por minuto (para medir el consumo real frente a los límites del proveedor).
 * Una fila por minuto, proveedor, modelo y tipo de uso; no guarda el contenido de los pedidos.
 */
export const sql = `
create table ai_usage (
  minute timestamptz not null,
  provider text not null,
  model text not null,
  kind text not null check (kind in ('asistente', 'factura')),
  requests integer not null default 0 check (requests >= 0),
  limited integer not null default 0 check (limited >= 0),
  errors integer not null default 0 check (errors >= 0),
  primary key (minute, provider, model, kind)
);

alter table ai_usage enable row level security;
`;
