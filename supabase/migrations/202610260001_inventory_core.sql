create extension if not exists pgcrypto;

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  currency text not null default 'ARS' check (currency = 'ARS'),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner', 'admin', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  tax_id text,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  normalized_name text generated always as (lower(trim(name))) stored,
  category text,
  brand text,
  base_unit text not null check (base_unit in ('unidad', 'tubo', 'frasco', 'caja', 'paquete', 'g', 'mg', 'ml', 'l')),
  current_stock numeric(18,3) not null default 0 check (current_stock >= 0),
  minimum_stock numeric(18,3) not null default 0 check (minimum_stock >= 0),
  reference_cost numeric(18,4) check (reference_cost >= 0),
  supplier_name text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, normalized_name)
);

create table public.product_conversions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  presentation text not null,
  base_units_per_presentation numeric(18,6) not null check (base_units_per_presentation > 0),
  unique (product_id, presentation)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  supplier_name text,
  purchase_date date not null,
  invoice_type text,
  invoice_number text,
  currency text not null default 'ARS' check (currency = 'ARS'),
  subtotal numeric(18,2) not null check (subtotal >= 0),
  discounts numeric(18,2) not null default 0 check (discounts >= 0),
  taxes numeric(18,2) not null default 0 check (taxes >= 0),
  total numeric(18,2) not null check (total >= 0),
  description text not null,
  status text not null default 'confirmed' check (status in ('draft', 'confirmed', 'void')),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (clinic_id, idempotency_key),
  unique (clinic_id, invoice_type, invoice_number)
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  original_description text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  purchase_unit text not null,
  conversion_factor numeric(18,6) not null default 1 check (conversion_factor > 0),
  normalized_quantity numeric(18,3) not null check (normalized_quantity > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  discount numeric(18,2) not null default 0 check (discount >= 0),
  taxes numeric(18,2) not null default 0 check (taxes >= 0),
  line_total numeric(18,2) not null check (line_total >= 0)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  expense_date date not null,
  category text not null,
  description text not null,
  amount numeric(18,2) not null check (amount > 0),
  currency text not null default 'ARS' check (currency = 'ARS'),
  supplier_name text,
  purchase_id uuid unique references public.purchases(id) on delete restrict,
  status text not null default 'confirmed' check (status in ('confirmed', 'void')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('initial', 'purchase', 'consume', 'increase', 'set_stock', 'reversal')),
  direction text not null check (direction in ('in', 'out', 'adjustment')),
  quantity numeric(18,3) not null check (quantity > 0),
  previous_stock numeric(18,3) not null check (previous_stock >= 0),
  resulting_stock numeric(18,3) not null check (resulting_stock >= 0),
  reason text not null,
  origin text not null default 'manual' check (origin in ('manual', 'voice', 'invoice', 'adjustment', 'system')),
  note text,
  purchase_id uuid references public.purchases(id) on delete restrict,
  user_id uuid references auth.users(id) on delete restrict,
  idempotency_key uuid,
  reverses_movement_id uuid references public.stock_movements(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (clinic_id, idempotency_key)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  user_id uuid references auth.users(id) on delete restrict,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index products_clinic_active_name_idx on public.products (clinic_id, active, normalized_name);
create index movements_clinic_created_idx on public.stock_movements (clinic_id, created_at desc);
create index movements_product_created_idx on public.stock_movements (product_id, created_at desc);
create index expenses_clinic_date_idx on public.expenses (clinic_id, expense_date desc) where status = 'confirmed';
create index purchases_clinic_date_idx on public.purchases (clinic_id, purchase_date desc);
create index suppliers_clinic_name_idx on public.suppliers (clinic_id, name);
create index audit_clinic_created_idx on public.audit_log (clinic_id, created_at desc);

create or replace function public.is_clinic_member(p_clinic_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic_id and m.user_id = auth.uid() and m.active) $$;

create or replace function public.can_manage_clinic(p_clinic_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic_id and m.user_id = auth.uid() and m.active and m.role in ('owner', 'admin', 'staff')) $$;

create or replace function public.bootstrap_clinic(p_name text)
returns public.clinics language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_clinic public.clinics;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida'; end if;
  if exists (select 1 from public.clinic_members where user_id = auth.uid() and active) then raise exception 'La cuenta ya pertenece a un consultorio'; end if;
  insert into public.clinics(name) values (trim(p_name)) returning * into v_clinic;
  insert into public.clinic_members(clinic_id, user_id, role) values (v_clinic.id, auth.uid(), 'owner');
  insert into public.profiles(id) values (auth.uid()) on conflict (id) do nothing;
  insert into public.audit_log(clinic_id, user_id, entity_type, entity_id, action) values (v_clinic.id, auth.uid(), 'clinic', v_clinic.id, 'created');
  return v_clinic;
end $$;

create or replace function public.create_product(p_product jsonb)
returns public.products language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_clinic uuid; v_product public.products; v_initial numeric(18,3);
begin
  select clinic_id into v_clinic from public.clinic_members where user_id = auth.uid() and active order by created_at, clinic_id limit 1;
  if v_clinic is null or not public.can_manage_clinic(v_clinic) then raise exception 'No autorizado para crear productos'; end if;
  v_initial := coalesce((p_product->>'initial_stock')::numeric, 0);
  insert into public.products(clinic_id, name, category, brand, base_unit, current_stock, minimum_stock, reference_cost, supplier_name, description)
  values (v_clinic, trim(p_product->>'name'), nullif(trim(p_product->>'category'), ''), nullif(trim(p_product->>'brand'), ''), p_product->>'base_unit', v_initial, coalesce((p_product->>'minimum_stock')::numeric, 0), nullif(p_product->>'reference_cost', '')::numeric, nullif(trim(p_product->>'supplier_name'), ''), nullif(trim(p_product->>'description'), '')) returning * into v_product;
  if v_initial > 0 then
    insert into public.stock_movements(clinic_id, product_id, movement_type, direction, quantity, previous_stock, resulting_stock, reason, origin, user_id)
    values (v_clinic, v_product.id, 'initial', 'in', v_initial, 0, v_initial, 'Stock inicial', 'system', auth.uid());
  end if;
  insert into public.audit_log(clinic_id, user_id, entity_type, entity_id, action) values (v_clinic, auth.uid(), 'product', v_product.id, 'created');
  return v_product;
end $$;

create or replace function public.update_product(p_product_id uuid, p_product jsonb, p_active boolean)
returns public.products language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_product public.products;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found or not public.can_manage_clinic(v_product.clinic_id) then raise exception 'Producto no encontrado o acceso no autorizado'; end if;
  if not p_active then
    update public.products set active = false, updated_at = now() where id = p_product_id returning * into v_product;
    insert into public.audit_log(clinic_id, user_id, entity_type, entity_id, action)
    values (v_product.clinic_id, auth.uid(), 'product', v_product.id, 'archived');
    return v_product;
  end if;
  if p_product->>'base_unit' is distinct from v_product.base_unit and (
    v_product.current_stock <> 0
    or exists (select 1 from public.stock_movements where product_id = p_product_id)
    or exists (select 1 from public.purchase_items where product_id = p_product_id)
  ) then raise exception 'No se puede cambiar la unidad base de un producto con historial'; end if;
  update public.products set
    name = trim(p_product->>'name'),
    category = nullif(trim(p_product->>'category'), ''),
    brand = nullif(trim(p_product->>'brand'), ''),
    base_unit = p_product->>'base_unit',
    minimum_stock = coalesce((p_product->>'minimum_stock')::numeric, 0),
    reference_cost = nullif(p_product->>'reference_cost', '')::numeric,
    supplier_name = nullif(trim(p_product->>'supplier_name'), ''),
    description = nullif(trim(p_product->>'description'), ''),
    active = p_active,
    updated_at = now()
  where id = p_product_id returning * into v_product;
  insert into public.audit_log(clinic_id, user_id, entity_type, entity_id, action)
  values (v_product.clinic_id, auth.uid(), 'product', v_product.id, case when p_active then 'updated' else 'archived' end);
  return v_product;
end $$;

create or replace function public.record_stock_movement(p_product_id uuid, p_movement_type text, p_quantity numeric, p_absolute_stock numeric, p_reason text, p_note text, p_idempotency_key uuid)
returns public.stock_movements language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_product public.products; v_target numeric(18,3); v_delta numeric(18,3); v_movement public.stock_movements; v_kind text;
begin
  select * into v_product from public.products where id = p_product_id and active for update;
  if not found or not public.can_manage_clinic(v_product.clinic_id) then raise exception 'Producto no encontrado o acceso no autorizado'; end if;
  if p_idempotency_key is not null then
    select * into v_movement from public.stock_movements where clinic_id = v_product.clinic_id and idempotency_key = p_idempotency_key;
    if found then return v_movement; end if;
  end if;
  if p_movement_type = 'set_stock' then
    if p_absolute_stock is null or p_absolute_stock < 0 then raise exception 'La cantidad absoluta no es válida'; end if;
    v_target := p_absolute_stock;
    v_delta := abs(v_target - v_product.current_stock);
    v_kind := 'set_stock';
  elsif p_movement_type = 'consume' then
    if p_quantity is null or p_quantity <= 0 or p_quantity > v_product.current_stock then raise exception 'Stock insuficiente para realizar el consumo'; end if;
    v_target := v_product.current_stock - p_quantity;
    v_delta := p_quantity;
    v_kind := 'consume';
  elsif p_movement_type = 'increase' then
    if p_quantity is null or p_quantity <= 0 then raise exception 'La cantidad debe ser mayor que cero'; end if;
    v_target := v_product.current_stock + p_quantity;
    v_delta := p_quantity;
    v_kind := 'increase';
  else raise exception 'Tipo de movimiento inválido'; end if;
  if v_delta = 0 then raise exception 'La cantidad ya coincide con el stock actual'; end if;
  update public.products set current_stock = v_target, updated_at = now() where id = v_product.id;
  insert into public.stock_movements(clinic_id, product_id, movement_type, direction, quantity, previous_stock, resulting_stock, reason, note, user_id, idempotency_key)
  values (v_product.clinic_id, v_product.id, v_kind, case when p_movement_type = 'increase' then 'in' when p_movement_type = 'consume' then 'out' else 'adjustment' end, greatest(v_delta, 0.001), v_product.current_stock, v_target, p_reason, p_note, auth.uid(), p_idempotency_key) returning * into v_movement;
  insert into public.audit_log(clinic_id, user_id, entity_type, entity_id, action) values (v_product.clinic_id, auth.uid(), 'stock_movement', v_movement.id, 'created');
  return v_movement;
end $$;

create or replace function public.confirm_purchase(p_purchase jsonb, p_idempotency_key uuid)
returns public.purchases language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_clinic uuid; v_purchase public.purchases; v_item jsonb; v_product public.products; v_qty numeric(18,3); v_unit_price numeric(18,4); v_total numeric(18,2) := 0; v_subtotal numeric(18,2) := 0; v_line numeric(18,2);
begin
  select clinic_id into v_clinic from public.clinic_members where user_id = auth.uid() and active order by created_at, clinic_id limit 1;
  if v_clinic is null or not public.can_manage_clinic(v_clinic) then raise exception 'No autorizado para registrar compras'; end if;
  select * into v_purchase from public.purchases where clinic_id = v_clinic and idempotency_key = p_idempotency_key;
  if found then return v_purchase; end if;
  if p_purchase->'items' is null or jsonb_typeof(p_purchase->'items') <> 'array' or jsonb_array_length(p_purchase->'items') = 0 then raise exception 'La compra debe tener líneas'; end if;
  for v_item in select value from jsonb_array_elements(p_purchase->'items') loop
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and clinic_id = v_clinic and active for update;
    if not found then raise exception 'Producto de compra no válido'; end if;
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    if v_qty <= 0 or v_unit_price < 0 then raise exception 'Cantidad o precio de compra inválido'; end if;
    v_line := round(v_qty * v_unit_price, 2);
    v_subtotal := v_subtotal + v_line;
  end loop;
  v_total := v_subtotal;
  insert into public.purchases(clinic_id, supplier_name, purchase_date, subtotal, total, description, idempotency_key, created_by, confirmed_at)
  values (v_clinic, nullif(trim(p_purchase->>'supplier_name'), ''), (p_purchase->>'purchase_date')::date, v_subtotal, v_total, p_purchase->>'description', p_idempotency_key, auth.uid(), now()) returning * into v_purchase;
  for v_item in select value from jsonb_array_elements(p_purchase->'items') loop
    select * into v_product from public.products where id = (v_item->>'product_id')::uuid and clinic_id = v_clinic and active for update;
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line := round(v_qty * v_unit_price, 2);
    insert into public.purchase_items(clinic_id, purchase_id, product_id, original_description, quantity, purchase_unit, normalized_quantity, unit_price, line_total)
    values (v_clinic, v_purchase.id, v_product.id, v_product.name, v_qty, v_product.base_unit, v_qty, v_unit_price, v_line);
    update public.products set current_stock = current_stock + v_qty, reference_cost = v_unit_price, updated_at = now() where id = v_product.id;
    insert into public.stock_movements(clinic_id, product_id, movement_type, direction, quantity, previous_stock, resulting_stock, reason, origin, purchase_id, user_id, idempotency_key)
    values (v_clinic, v_product.id, 'purchase', 'in', v_qty, v_product.current_stock, v_product.current_stock + v_qty, 'Compra', 'manual', v_purchase.id, auth.uid(), gen_random_uuid());
  end loop;
  insert into public.expenses(clinic_id, expense_date, category, description, amount, supplier_name, purchase_id, created_by)
  values (v_clinic, v_purchase.purchase_date, 'Materiales', v_purchase.description, v_total, v_purchase.supplier_name, v_purchase.id, auth.uid());
  insert into public.audit_log(clinic_id, user_id, entity_type, entity_id, action) values (v_clinic, auth.uid(), 'purchase', v_purchase.id, 'confirmed');
  return v_purchase;
end $$;

create or replace function public.create_manual_expense(p_expense jsonb)
returns public.expenses language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_clinic uuid; v_expense public.expenses;
begin
  select clinic_id into v_clinic from public.clinic_members where user_id = auth.uid() and active order by created_at, clinic_id limit 1;
  if v_clinic is null or not public.can_manage_clinic(v_clinic) then raise exception 'No autorizado para registrar gastos'; end if;
  insert into public.expenses(clinic_id, expense_date, category, description, amount, supplier_name, created_by)
  values (v_clinic, (p_expense->>'expense_date')::date, p_expense->>'category', p_expense->>'description', (p_expense->>'amount')::numeric, nullif(trim(p_expense->>'supplier_name'), ''), auth.uid()) returning * into v_expense;
  insert into public.audit_log(clinic_id, user_id, entity_type, entity_id, action) values (v_clinic, auth.uid(), 'expense', v_expense.id, 'created');
  return v_expense;
end $$;

create or replace function public.create_supplier(p_supplier jsonb)
returns public.suppliers language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_clinic uuid; v_supplier public.suppliers;
begin
  select clinic_id into v_clinic from public.clinic_members where user_id = auth.uid() and active order by created_at, clinic_id limit 1;
  if v_clinic is null or not public.can_manage_clinic(v_clinic) then raise exception 'No autorizado para gestionar proveedores'; end if;
  insert into public.suppliers(clinic_id, name, tax_id, phone, email, address, notes)
  values (v_clinic, trim(p_supplier->>'name'), nullif(trim(p_supplier->>'tax_id'), ''), nullif(trim(p_supplier->>'phone'), ''), nullif(trim(p_supplier->>'email'), ''), nullif(trim(p_supplier->>'address'), ''), nullif(trim(p_supplier->>'notes'), '')) returning * into v_supplier;
  return v_supplier;
end $$;

alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.clinic_members enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_conversions enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.expenses enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_log enable row level security;

create policy clinic_member_read on public.clinics for select to authenticated using (public.is_clinic_member(id));
create policy profile_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy member_read_clinic on public.clinic_members for select to authenticated using (public.is_clinic_member(clinic_id));
create policy suppliers_read_clinic on public.suppliers for select to authenticated using (public.is_clinic_member(clinic_id));
create policy products_read_clinic on public.products for select to authenticated using (public.is_clinic_member(clinic_id));
create policy conversions_read_clinic on public.product_conversions for select to authenticated using (public.is_clinic_member(clinic_id));
create policy purchases_read_clinic on public.purchases for select to authenticated using (public.is_clinic_member(clinic_id));
create policy purchase_items_read_clinic on public.purchase_items for select to authenticated using (public.is_clinic_member(clinic_id));
create policy expenses_read_clinic on public.expenses for select to authenticated using (public.is_clinic_member(clinic_id));
create policy movements_read_clinic on public.stock_movements for select to authenticated using (public.is_clinic_member(clinic_id));
create policy audit_read_clinic on public.audit_log for select to authenticated using (public.is_clinic_member(clinic_id));

revoke all on public.clinics, public.profiles, public.clinic_members, public.suppliers, public.products, public.product_conversions, public.purchases, public.purchase_items, public.expenses, public.stock_movements, public.audit_log from anon;
grant select on public.clinics, public.profiles, public.clinic_members, public.suppliers, public.products, public.product_conversions, public.purchases, public.purchase_items, public.expenses, public.stock_movements, public.audit_log to authenticated;
revoke all on function public.is_clinic_member(uuid), public.can_manage_clinic(uuid), public.bootstrap_clinic(text), public.create_product(jsonb), public.update_product(uuid, jsonb, boolean), public.record_stock_movement(uuid, text, numeric, numeric, text, text, uuid), public.confirm_purchase(jsonb, uuid), public.create_manual_expense(jsonb), public.create_supplier(jsonb) from public;
grant execute on function public.is_clinic_member(uuid), public.can_manage_clinic(uuid), public.bootstrap_clinic(text), public.create_product(jsonb), public.update_product(uuid, jsonb, boolean), public.record_stock_movement(uuid, text, numeric, numeric, text, text, uuid), public.confirm_purchase(jsonb, uuid), public.create_manual_expense(jsonb), public.create_supplier(jsonb) to authenticated;