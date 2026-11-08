/**
 * Esquema inicial de consultorIA.
 *
 * Principios:
 * - Los movimientos de stock y el registro de auditoría son inmutables (trigger).
 *   Los errores se corrigen con reversiones o ajustes, nunca borrando historia.
 * - Los productos, proveedores y presentaciones no se borran: se archivan.
 * - Cantidades en NUMERIC(14,3) (unidad base del producto) y dinero en NUMERIC(14,2) ARS.
 * - Las fechas "del hecho" (compra, gasto, consumo) son DATE en hora de Buenos Aires;
 *   los instantes de registro son TIMESTAMPTZ (UTC).
 * - RLS habilitado en todas las tablas sin políticas: solo el rol dueño (el servidor)
 *   puede leer/escribir. Si alguna vez se expone la base con una API pública,
 *   los roles anónimos no ven nada.
 */
export const sql = String.raw`
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  normalized_name text not null,
  cuit text check (cuit is null or cuit ~ '^[0-9]{11}$'),
  phone text,
  email text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_name_uq on suppliers (normalized_name) where archived_at is null;
create unique index suppliers_cuit_uq on suppliers (cuit) where cuit is not null and archived_at is null;

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  normalized_name text not null,
  category text,
  description text,
  base_unit text not null check (base_unit in ('unidad','par','g','mg','kg','ml','l','cm','m')),
  current_stock numeric(14,3) not null default 0 check (current_stock >= 0),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  unit_cost numeric(16,4) check (unit_cost is null or unit_cost >= 0),
  tracks_expiry boolean not null default false,
  barcode text,
  archived_at timestamptz,
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_name_uq on products (normalized_name) where archived_at is null;
create index products_category_idx on products (category);

create table product_presentations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  name text not null check (length(btrim(name)) between 1 and 60),
  normalized_name text not null,
  factor numeric(14,3) not null check (factor > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index product_presentations_uq on product_presentations (product_id, normalized_name) where archived_at is null;

create table product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  alias_normalized text not null,
  supplier_id uuid references suppliers(id),
  presentation_id uuid references product_presentations(id),
  created_at timestamptz not null default now()
);
create unique index product_aliases_uq on product_aliases (alias_normalized, coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  lot_code text,
  expires_on date,
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index lots_uq on lots (product_id, coalesce(lot_code, ''), coalesce(expires_on, 'infinity'::date));
create index lots_expiry_idx on lots (expires_on) where quantity > 0;

create table documents (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity unique,
  status text not null default 'pendiente'
    check (status in ('pendiente','analizado','error','registrado','descartado')),
  extraction jsonb,
  extraction_model text,
  extraction_error text,
  extracted_at timestamptz,
  linked_purchase_id uuid,
  linked_expense_id uuid,
  discarded_reason text,
  actor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id),
  position integer not null,
  storage text not null check (storage in ('blob','local','none')),
  storage_key text,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes >= 0),
  sha256 text not null,
  created_at timestamptz not null default now()
);
create index document_files_sha_idx on document_files (sha256);
create index document_files_doc_idx on document_files (document_id, position);

create table operations (
  id uuid primary key,
  idempotency_key text unique,
  kind text not null,
  source text not null,
  actor text,
  summary text,
  result jsonb,
  created_at timestamptz not null default now()
);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity unique,
  supplier_id uuid references suppliers(id),
  purchase_date date not null,
  doc_type text check (doc_type in ('factura_a','factura_b','factura_c','factura_m','ticket','recibo','remito','nota_credito','otro')),
  doc_number text,
  subtotal numeric(14,2) check (subtotal is null or subtotal >= 0),
  tax_amount numeric(14,2) check (tax_amount is null or tax_amount >= 0),
  other_taxes numeric(14,2) check (other_taxes is null or other_taxes >= 0),
  total numeric(14,2) check (total is null or total >= 0),
  status text not null default 'registrada' check (status in ('registrada','pendiente_precio','anulada')),
  notes text,
  source text not null check (source in ('manual','texto','voz','factura')),
  document_id uuid references documents(id),
  operation_id uuid not null references operations(id),
  actor text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'registrada' or total is not null),
  check (status <> 'anulada' or (voided_at is not null and void_reason is not null))
);
create unique index purchases_doc_uq on purchases (supplier_id, doc_type, doc_number)
  where doc_number is not null and status <> 'anulada';
create index purchases_date_idx on purchases (purchase_date);

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id),
  position integer not null,
  product_id uuid references products(id),
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null,
  base_quantity numeric(14,3),
  unit_price numeric(14,2) check (unit_price is null or unit_price >= 0),
  line_total numeric(14,2) check (line_total is null or line_total >= 0),
  lot_code text,
  expires_on date,
  check (product_id is null or (base_quantity is not null and base_quantity > 0))
);
create index purchase_items_purchase_idx on purchase_items (purchase_id, position);
create index purchase_items_product_idx on purchase_items (product_id);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity unique,
  expense_date date not null,
  category text not null check (length(btrim(category)) between 1 and 80),
  description text not null check (length(btrim(description)) between 1 and 300),
  amount numeric(14,2) not null check (amount > 0),
  supplier_id uuid references suppliers(id),
  doc_type text check (doc_type in ('factura_a','factura_b','factura_c','factura_m','ticket','recibo','remito','nota_credito','otro')),
  doc_number text,
  status text not null default 'registrado' check (status in ('registrado','anulado')),
  notes text,
  source text not null check (source in ('manual','texto','voz','factura')),
  document_id uuid references documents(id),
  operation_id uuid not null references operations(id),
  actor text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'anulado' or (voided_at is not null and void_reason is not null))
);
create index expenses_date_idx on expenses (expense_date);
create unique index expenses_doc_uq on expenses (supplier_id, doc_type, doc_number)
  where doc_number is not null and supplier_id is not null and status <> 'anulado';

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  product_id uuid not null references products(id),
  lot_id uuid references lots(id),
  kind text not null check (kind in ('stock_inicial','compra','ingreso','consumo','ajuste','reversion','vencimiento')),
  quantity numeric(14,3) not null check (quantity <> 0),
  stock_before numeric(14,3) not null check (stock_before >= 0),
  stock_after numeric(14,3) not null check (stock_after >= 0),
  input_quantity numeric(14,3),
  input_unit text,
  unit_cost numeric(16,4),
  reason text,
  source text not null check (source in ('manual','texto','voz','factura','sistema')),
  purchase_id uuid references purchases(id),
  purchase_item_id uuid references purchase_items(id),
  reverses_movement_id uuid references stock_movements(id),
  operation_id uuid not null references operations(id),
  actor text,
  effective_date date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  created_at timestamptz not null default now(),
  check (stock_after = stock_before + quantity),
  check (kind not in ('consumo','vencimiento') or quantity < 0),
  check (kind not in ('stock_inicial','compra','ingreso') or quantity > 0),
  check (kind <> 'reversion' or reverses_movement_id is not null)
);
create unique index stock_movements_reverses_uq on stock_movements (reverses_movement_id) where reverses_movement_id is not null;
create index stock_movements_product_idx on stock_movements (product_id, number desc);
create index stock_movements_date_idx on stock_movements (effective_date);
create index stock_movements_operation_idx on stock_movements (operation_id);
create index stock_movements_purchase_idx on stock_movements (purchase_id) where purchase_id is not null;

create table audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text,
  action text not null,
  details jsonb,
  source text not null,
  actor text,
  operation_id uuid,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);
create index audit_log_created_idx on audit_log (created_at desc);

create table login_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  success boolean not null,
  attempted_at timestamptz not null default now()
);
create index login_attempts_ip_idx on login_attempts (ip, attempted_at desc);

create function forbid_history_mutation() returns trigger
language plpgsql as $fn$
begin
  raise exception 'La tabla % es un historial inmutable: registrá una reversión o un ajuste en lugar de modificarla.', tg_table_name
    using errcode = 'P0001';
end
$fn$;

create trigger stock_movements_immutable
  before update or delete on stock_movements
  for each row execute function forbid_history_mutation();

create trigger audit_log_immutable
  before update or delete on audit_log
  for each row execute function forbid_history_mutation();

alter table app_settings enable row level security;
alter table suppliers enable row level security;
alter table products enable row level security;
alter table product_presentations enable row level security;
alter table product_aliases enable row level security;
alter table lots enable row level security;
alter table documents enable row level security;
alter table document_files enable row level security;
alter table operations enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table expenses enable row level security;
alter table stock_movements enable row level security;
alter table audit_log enable row level security;
alter table login_attempts enable row level security;
`;
