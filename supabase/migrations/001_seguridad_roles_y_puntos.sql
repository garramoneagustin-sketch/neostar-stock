-- =====================================================================
-- 001 · Seguridad por roles + mini depósito por punto (Cañada, Santa Fe...)
-- Ejecutar UNA vez en Supabase > SQL Editor. Es re-ejecutable (idempotente).
--
-- ANTES DE CORRER: cambiá el mail de admin en el bloque "ADMIN" (sección 9)
-- si tu usuario de la app no es agarramone@neostar.com.ar.
-- Si no existe ningún admin al final, falla con error y no se aplica nada (no te bloqueás).
--
-- Roles:
--   admin   · todo, incluida la gestión de usuarios
--   editor  · ve todo, carga/mueve/elimina (Virginia, Santiago)
--   punto   · solo ve y opera SU depósito (profiles.destination_id)
--   viewer  · solo lectura
-- =====================================================================

-- ---------- 0. Tablas que pudieron no crearse (schema-complete.sql) ----------
create extension if not exists pgcrypto;

alter table public.items add column if not exists sku text;
alter table public.items add column if not exists subcategory text;
alter table public.items add column if not exists occasion text;
alter table public.items add column if not exists stock_canada integer default 0;
alter table public.items add column if not exists stock_funes integer default 0;
create unique index if not exists items_sku_unique on public.items(sku) where sku is not null and sku <> '';

create table if not exists public.restocks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  qty integer not null check (qty > 0),
  source text not null check (source in ('proveedor','devolucion','ajuste')),
  cost numeric, person text, notes text,
  created_at timestamptz default now());

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  qty integer not null check (qty > 0),
  reason_type text not null check (reason_type in ('regalo_corporativo','incidencia_cliente','uso_interno','otro')),
  reason_detail text, recipient_last_name text, vehicle_plate text, person text, notes text,
  created_at timestamptz default now());

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null, event_date date not null, trello_id text, carried_by text,
  status text not null default 'abierto' check (status in ('abierto','cerrado','cancelado')),
  notes text, created_at timestamptz default now(), closed_at timestamptz);

create table if not exists public.event_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  qty_allocated integer not null check (qty_allocated > 0),
  qty_returned integer default 0 check (qty_returned >= 0),
  qty_used integer generated always as (qty_allocated - coalesce(qty_returned,0)) stored,
  remito_salida_date timestamptz, remito_salida_signed_by text,
  remito_llegada_date timestamptz, remito_llegada_signed_by text,
  remito_llegada_ok boolean default false,
  created_at timestamptz default now());

-- ---------- 1. Perfiles y roles ----------
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='c' loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','editor','punto','viewer'));
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists destination_id uuid;

-- ---------- 2. Destinos: nombre único (sin duplicados) + datos de restock ----------
with keep as (
  select name, (array_agg(id order by created_at, id))[1] as keep_id
  from public.destinations group by name having count(*) > 1)
update public.movements m set destino_id = k.keep_id
from public.destinations d join keep k on k.name = d.name
where m.destino_id = d.id and d.id <> k.keep_id;

delete from public.destinations d using (
  select name, (array_agg(id order by created_at, id))[1] as keep_id
  from public.destinations group by name having count(*) > 1) k
where d.name = k.name and d.id <> k.keep_id;

create unique index if not exists destinations_name_unique on public.destinations(name);
alter table public.destinations add column if not exists restock_lead_days integer not null default 7;
alter table public.destinations add column if not exists active boolean not null default true;
alter table public.items add column if not exists active boolean not null default true;

do $$ begin
  alter table public.profiles add constraint profiles_destination_fk
    foreign key (destination_id) references public.destinations(id) on delete set null;
exception when duplicate_object then null; end $$;

insert into public.destinations(name, abastecido_por, marcas) values
  ('Santa Fe',        'nucleo', array['Nissan','Kia','BYD','Jeep','RAM','Honda','Suzuki','Subaru']),
  ('Cañada de Gómez', 'nucleo', array['Nissan','Jeep','RAM','Kia']),
  ('Funes',           'nucleo', array['Jeep','RAM','Honda'])
on conflict (name) do nothing;

-- ---------- 3. Stock por depósito/punto ----------
create table if not exists public.destination_stock (
  destination_id uuid not null references public.destinations(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  qty integer not null default 0 check (qty >= 0),
  min_qty integer not null default 0 check (min_qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (destination_id, item_id));

-- Migra lo que hubiera en las columnas viejas (stock_sf / stock_canada / stock_funes).
-- Esas columnas quedan sin uso: de acá en adelante manda destination_stock.
insert into public.destination_stock(destination_id, item_id, qty)
select d.id, i.id, i.stock_sf from public.items i join public.destinations d on d.name='Santa Fe' where coalesce(i.stock_sf,0) > 0
on conflict do nothing;
insert into public.destination_stock(destination_id, item_id, qty)
select d.id, i.id, i.stock_canada from public.items i join public.destinations d on d.name='Cañada de Gómez' where coalesce(i.stock_canada,0) > 0
on conflict do nothing;
insert into public.destination_stock(destination_id, item_id, qty)
select d.id, i.id, i.stock_funes from public.items i join public.destinations d on d.name='Funes' where coalesce(i.stock_funes,0) > 0
on conflict do nothing;

-- ---------- 4. Movimientos: campos de recepción y trazabilidad ----------
alter table public.movements add column if not exists origen_id uuid references public.destinations(id);
alter table public.movements add column if not exists recipient_name text;
alter table public.movements add column if not exists vehicle_plate text;
alter table public.movements add column if not exists qty_received integer;
alter table public.movements add column if not exists received_by uuid;
alter table public.movements add column if not exists received_by_name text;
alter table public.movements add column if not exists received_at timestamptz;
create index if not exists movements_destino on public.movements(destino_id, estado);
create index if not exists movements_origen on public.movements(origen_id, type, fecha);
create index if not exists destination_stock_item on public.destination_stock(item_id);

-- ---------- 5. Helpers de identidad ----------
create or replace function public.app_role() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'none') $$;
create or replace function public.app_destination() returns uuid language sql stable security definer set search_path = public as $$
  select destination_id from public.profiles where id = auth.uid() $$;
create or replace function public.app_person() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(full_name,'') from public.profiles where id = auth.uid()),
                  (select email from public.profiles where id = auth.uid()), 'desconocido') $$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() in ('admin','editor') $$;
create or replace function public.can_use_destination(p_dest uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or (public.app_role() = 'punto' and p_dest is not null and p_dest = public.app_destination()) $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, 'viewer')
  on conflict (id) do nothing;
  return new;
end; $$;

insert into public.profiles(id, full_name, email)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', u.email), u.email from auth.users u
on conflict (id) do nothing;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- ---------- 6. El stock del Depo Central solo cambia por funciones (queda registro) ----------
create or replace function public.guard_item_stock() returns trigger language plpgsql as $$
begin
  if (new.stock_nucleo, new.total_qty, new.danados)
       is distinct from (old.stock_nucleo, old.total_qty, old.danados)
     and coalesce(current_setting('app.stock_rpc', true), '') <> 'on' then
    raise exception 'El stock no se edita directo: usá Ingreso, Retiro, Movimiento o Ajuste (así queda registro).';
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists items_guard_stock on public.items;
create trigger items_guard_stock before update on public.items for each row execute function public.guard_item_stock();

-- Si se crea un material con stock inicial, queda asentado como movimiento.
create or replace function public.log_initial_stock() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.stock_nucleo,0) > 0 then
    insert into public.movements(item_id, type, qty, fecha, origen, person, created_by, notes)
    values (new.id, 'stock_inicial', new.stock_nucleo, current_date, 'Depo Central', public.app_person(), auth.uid(), 'Stock inicial al crear el material');
  end if;
  return new;
end; $$;
drop trigger if exists items_log_initial on public.items;
create trigger items_log_initial after insert on public.items for each row execute function public.log_initial_stock();

-- ---------- 7. Políticas de seguridad (RLS) ----------
do $$ declare p record; begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname='public' and tablename in
             ('profiles','destinations','items','movements','restocks','withdrawals','events','event_items','destination_stock') loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.profiles          enable row level security;
alter table public.destinations      enable row level security;
alter table public.items             enable row level security;
alter table public.movements         enable row level security;
alter table public.restocks          enable row level security;
alter table public.withdrawals       enable row level security;
alter table public.events            enable row level security;
alter table public.event_items       enable row level security;
alter table public.destination_stock enable row level security;

-- perfiles: cada uno ve el suyo; staff ve todos; solo admin cambia roles
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- destinos: staff y viewer ven todos; el punto ve solo el suyo
create policy destinations_select on public.destinations for select to authenticated
  using (public.app_role() in ('admin','editor','viewer') or id = public.app_destination());
create policy destinations_write on public.destinations for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- materiales: todos los usuarios con rol los ven; staff crea/edita/elimina (el stock lo frena el trigger)
create policy items_select on public.items for select to authenticated using (public.app_role() <> 'none');
create policy items_insert on public.items for insert to authenticated with check (public.is_staff());
create policy items_update on public.items for update to authenticated using (public.is_staff()) with check (public.is_staff());
-- (sin política de DELETE directo: eliminar se hace con delete_item(), que conserva el historial)

-- stock por depósito: lectura según rol; escritura SOLO vía funciones
create policy dstock_select on public.destination_stock for select to authenticated
  using (public.app_role() in ('admin','editor','viewer') or destination_id = public.app_destination());

-- movimientos: staff/viewer ven todo; el punto ve los que entran o salen de su depósito. Escritura SOLO vía funciones
create policy movements_select on public.movements for select to authenticated
  using (public.app_role() in ('admin','editor','viewer')
         or destino_id = public.app_destination() or origen_id = public.app_destination());

-- ingresos / retiros / eventos: lectura staff+viewer; escritura SOLO vía funciones
create policy restocks_select on public.restocks for select to authenticated using (public.app_role() in ('admin','editor','viewer'));
create policy withdrawals_select on public.withdrawals for select to authenticated using (public.app_role() in ('admin','editor','viewer'));
create policy events_select on public.events for select to authenticated using (public.app_role() in ('admin','editor','viewer'));
create policy event_items_select on public.event_items for select to authenticated using (public.app_role() in ('admin','editor','viewer'));

-- ---------- 8. Funciones de operación ----------
create or replace function public._require_staff() returns void language plpgsql stable security definer set search_path = public as $$
begin if not public.is_staff() then raise exception 'No tenés permiso para esta operación'; end if; end; $$;

-- Ingreso (compra a proveedor, devolución) al Depo Central
create or replace function public.register_restock(p_item_id uuid, p_qty integer, p_source text,
  p_cost numeric default null, p_person text default null, p_notes text default null)
returns public.restocks language plpgsql security definer set search_path = public as $$
declare r public.restocks;
begin
  perform public._require_staff();
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  perform set_config('app.stock_rpc','on',true);
  update public.items set stock_nucleo = stock_nucleo + p_qty where id = p_item_id;
  if not found then raise exception 'Material inexistente'; end if;
  insert into public.restocks(item_id, qty, source, cost, person, notes)
  values (p_item_id, p_qty, p_source, p_cost, public.app_person(), p_notes) returning * into r;
  return r;
end; $$;

-- Retiro desde el Depo Central (regalo, incidencia, uso interno)
create or replace function public.register_withdrawal(p_item_id uuid, p_qty integer, p_reason_type text,
  p_reason_detail text default null, p_recipient_last_name text default null, p_vehicle_plate text default null,
  p_person text default null, p_notes text default null)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare r public.withdrawals;
begin
  perform public._require_staff();
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if p_reason_type = 'incidencia_cliente'
     and (coalesce(trim(p_recipient_last_name),'') = '' or coalesce(trim(p_vehicle_plate),'') = '') then
    raise exception 'Para incidencia con cliente, apellido y patente son obligatorios';
  end if;
  perform set_config('app.stock_rpc','on',true);
  update public.items set stock_nucleo = stock_nucleo - p_qty where id = p_item_id and stock_nucleo >= p_qty;
  if not found then raise exception 'Stock insuficiente en Depo Central'; end if;
  insert into public.withdrawals(item_id, qty, reason_type, reason_detail, recipient_last_name, vehicle_plate, person, notes)
  values (p_item_id, p_qty, p_reason_type, p_reason_detail, p_recipient_last_name, p_vehicle_plate, public.app_person(), p_notes)
  returning * into r;
  return r;
end; $$;

-- Envío Depo Central -> depósito/punto. Queda "en tránsito" hasta que lo reciben.
drop function if exists public.register_movement_transfer(uuid, integer, text, text, text, text);
create or replace function public.send_to_destination(p_item_id uuid, p_destination_id uuid, p_qty integer,
  p_recipient_name text default null, p_notes text default null)
returns public.movements language plpgsql security definer set search_path = public as $$
declare r public.movements; d public.destinations;
begin
  perform public._require_staff();
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select * into d from public.destinations where id = p_destination_id;
  if not found then raise exception 'Destino inexistente'; end if;
  perform set_config('app.stock_rpc','on',true);
  update public.items set stock_nucleo = stock_nucleo - p_qty where id = p_item_id and stock_nucleo >= p_qty;
  if not found then raise exception 'Stock insuficiente en Depo Central'; end if;
  insert into public.movements(item_id, type, qty, fecha, origen, destino_id, destination, estado,
                               recipient_name, person, created_by, notes)
  values (p_item_id, 'envio_destino', p_qty, current_date, 'Depo Central', p_destination_id, d.name, 'en_transito',
          p_recipient_name, public.app_person(), auth.uid(), p_notes)
  returning * into r;
  return r;
end; $$;

-- Confirmar recepción: suma al stock del destino. Lo hace el punto (solo lo suyo) o staff.
create or replace function public.confirm_reception(p_movement_id uuid, p_qty_received integer default null, p_notes text default null)
returns public.movements language plpgsql security definer set search_path = public as $$
declare m public.movements; q integer;
begin
  select * into m from public.movements where id = p_movement_id for update;
  if not found then raise exception 'Movimiento inexistente'; end if;
  if m.type <> 'envio_destino' or m.estado <> 'en_transito' then raise exception 'Este envío ya fue recibido o no está en tránsito'; end if;
  if not public.can_use_destination(m.destino_id) then raise exception 'No tenés permiso para recibir en este depósito'; end if;
  q := coalesce(p_qty_received, m.qty);
  if q < 0 or q > m.qty then raise exception 'La cantidad recibida debe estar entre 0 y % (lo enviado)', m.qty; end if;
  insert into public.destination_stock(destination_id, item_id, qty)
  values (m.destino_id, m.item_id, q)
  on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
  update public.movements set
    estado = case when q = m.qty then 'recibido' else 'recibido_con_diferencia' end,
    qty_received = q, received_by = auth.uid(), received_by_name = public.app_person(), received_at = now(),
    notes = case when coalesce(p_notes,'') = '' then notes else coalesce(notes || ' · ', '') || 'Recepción: ' || p_notes end
  where id = p_movement_id returning * into m;
  return m;
end; $$;

-- Entrega/retiro desde el stock de un punto (Cañada entrega a un cliente, regalo, etc.)
create or replace function public.register_point_withdrawal(p_destination_id uuid, p_item_id uuid, p_qty integer,
  p_reason_type text, p_reason_detail text default null, p_recipient_last_name text default null,
  p_vehicle_plate text default null, p_notes text default null)
returns public.movements language plpgsql security definer set search_path = public as $$
declare r public.movements; d public.destinations;
begin
  if not public.can_use_destination(p_destination_id) then raise exception 'No tenés permiso sobre este depósito'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if p_reason_type not in ('regalo_corporativo','incidencia_cliente','uso_interno','otro') then raise exception 'Motivo inválido'; end if;
  if p_reason_type = 'incidencia_cliente'
     and (coalesce(trim(p_recipient_last_name),'') = '' or coalesce(trim(p_vehicle_plate),'') = '') then
    raise exception 'Para incidencia con cliente, apellido y patente son obligatorios';
  end if;
  select * into d from public.destinations where id = p_destination_id;
  update public.destination_stock set qty = qty - p_qty, updated_at = now()
   where destination_id = p_destination_id and item_id = p_item_id and qty >= p_qty;
  if not found then raise exception 'Stock insuficiente en %', coalesce(d.name,'el depósito'); end if;
  insert into public.movements(item_id, type, qty, fecha, origen, origen_id, estado, reason_type, reason_detail,
                               recipient_last_name, vehicle_plate, person, created_by, notes)
  values (p_item_id, 'entrega', p_qty, current_date, d.name, p_destination_id, 'entregado', p_reason_type, p_reason_detail,
          p_recipient_last_name, p_vehicle_plate, public.app_person(), auth.uid(), p_notes)
  returning * into r;
  return r;
end; $$;

-- Carga propia del punto (stock inicial, sobrante, material que llegó por otra vía). Queda registrado.
create or replace function public.register_point_stock_in(p_destination_id uuid, p_item_id uuid, p_qty integer, p_notes text default null)
returns public.movements language plpgsql security definer set search_path = public as $$
declare r public.movements; d public.destinations;
begin
  if not public.can_use_destination(p_destination_id) then raise exception 'No tenés permiso sobre este depósito'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select * into d from public.destinations where id = p_destination_id;
  insert into public.destination_stock(destination_id, item_id, qty) values (p_destination_id, p_item_id, p_qty)
  on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
  insert into public.movements(item_id, type, qty, fecha, destino_id, destination, estado, person, created_by, notes)
  values (p_item_id, 'ingreso_punto', p_qty, current_date, p_destination_id, d.name, 'recibido', public.app_person(), auth.uid(), p_notes)
  returning * into r;
  return r;
end; $$;

-- Punto de restock (mínimo) de un material en un depósito
create or replace function public.set_point_min(p_destination_id uuid, p_item_id uuid, p_min integer)
returns public.destination_stock language plpgsql security definer set search_path = public as $$
declare r public.destination_stock;
begin
  if not public.can_use_destination(p_destination_id) then raise exception 'No tenés permiso sobre este depósito'; end if;
  if p_min is null or p_min < 0 then raise exception 'El mínimo no puede ser negativo'; end if;
  insert into public.destination_stock(destination_id, item_id, qty, min_qty) values (p_destination_id, p_item_id, 0, p_min)
  on conflict (destination_id, item_id) do update set min_qty = excluded.min_qty, updated_at = now()
  returning * into r;
  return r;
end; $$;

-- Ajuste por conteo físico (obligatorio indicar motivo). p_destination_id = null -> Depo Central (solo staff)
create or replace function public.adjust_stock(p_item_id uuid, p_destination_id uuid, p_new_qty integer, p_reason text)
returns public.movements language plpgsql security definer set search_path = public as $$
declare r public.movements; cur integer; d public.destinations;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'El motivo del ajuste es obligatorio'; end if;
  if p_new_qty is null or p_new_qty < 0 then raise exception 'La cantidad no puede ser negativa'; end if;
  if p_destination_id is null then
    perform public._require_staff();
    select stock_nucleo into cur from public.items where id = p_item_id for update;
    if not found then raise exception 'Material inexistente'; end if;
    if cur = p_new_qty then raise exception 'El stock ya es %', cur; end if;
    perform set_config('app.stock_rpc','on',true);
    update public.items set stock_nucleo = p_new_qty where id = p_item_id;
    insert into public.movements(item_id, type, qty, fecha, origen, estado, reason_type, reason_detail, person, created_by, notes)
    values (p_item_id, 'ajuste', abs(p_new_qty - cur), current_date, 'Depo Central', 'ajustado', 'ajuste', p_reason,
            public.app_person(), auth.uid(), format('Stock %s → %s', cur, p_new_qty)) returning * into r;
  else
    if not public.can_use_destination(p_destination_id) then raise exception 'No tenés permiso sobre este depósito'; end if;
    select * into d from public.destinations where id = p_destination_id;
    select qty into cur from public.destination_stock where destination_id = p_destination_id and item_id = p_item_id for update;
    cur := coalesce(cur, 0);
    if cur = p_new_qty then raise exception 'El stock ya es %', cur; end if;
    insert into public.destination_stock(destination_id, item_id, qty) values (p_destination_id, p_item_id, p_new_qty)
    on conflict (destination_id, item_id) do update set qty = excluded.qty, updated_at = now();
    insert into public.movements(item_id, type, qty, fecha, origen, origen_id, estado, reason_type, reason_detail, person, created_by, notes)
    values (p_item_id, 'ajuste', abs(p_new_qty - cur), current_date, d.name, p_destination_id, 'ajustado', 'ajuste', p_reason,
            public.app_person(), auth.uid(), format('Stock %s → %s', cur, p_new_qty)) returning * into r;
  end if;
  return r;
end; $$;

-- ----- Eventos (mismo circuito de antes, ahora con permisos, validaciones y sin doble suma) -----
create or replace function public.open_event(p_event_name text, p_event_date date, p_carried_by text,
  p_trello_id text default null, p_notes text default null)
returns public.events language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  perform public._require_staff();
  insert into public.events(event_name, event_date, carried_by, trello_id, status, notes)
  values (p_event_name, p_event_date, p_carried_by, p_trello_id, 'abierto', p_notes) returning * into e;
  return e;
end; $$;

create or replace function public.add_item_to_event(p_event_id uuid, p_item_id uuid, p_qty_allocated integer,
  p_remito_salida_date timestamptz, p_remito_salida_signed_by text)
returns public.event_items language plpgsql security definer set search_path = public as $$
declare ei public.event_items; st text;
begin
  perform public._require_staff();
  if p_qty_allocated is null or p_qty_allocated <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select status into st from public.events where id = p_event_id;
  if st is distinct from 'abierto' then raise exception 'El evento no está abierto'; end if;
  perform set_config('app.stock_rpc','on',true);
  update public.items set stock_nucleo = stock_nucleo - p_qty_allocated where id = p_item_id and stock_nucleo >= p_qty_allocated;
  if not found then raise exception 'Stock insuficiente en Depo Central'; end if;
  insert into public.event_items(event_id, item_id, qty_allocated, remito_salida_date, remito_salida_signed_by)
  values (p_event_id, p_item_id, p_qty_allocated, coalesce(p_remito_salida_date, now()), p_remito_salida_signed_by)
  returning * into ei;
  return ei;
end; $$;

create or replace function public.close_event_item(p_event_item_id uuid, p_qty_returned integer,
  p_remito_llegada_date timestamptz, p_remito_llegada_signed_by text)
returns public.event_items language plpgsql security definer set search_path = public as $$
declare ei public.event_items;
begin
  perform public._require_staff();
  select * into ei from public.event_items where id = p_event_item_id for update;
  if not found then raise exception 'Registro inexistente'; end if;
  if ei.remito_llegada_ok then raise exception 'Este material ya fue controlado al regreso'; end if;
  if p_qty_returned is null or p_qty_returned < 0 or p_qty_returned > ei.qty_allocated then
    raise exception 'La cantidad devuelta debe estar entre 0 y % (lo que salió)', ei.qty_allocated;
  end if;
  perform set_config('app.stock_rpc','on',true);
  update public.event_items set qty_returned = p_qty_returned, remito_llegada_date = coalesce(p_remito_llegada_date, now()),
         remito_llegada_signed_by = p_remito_llegada_signed_by, remito_llegada_ok = true
   where id = p_event_item_id returning * into ei;
  update public.items set stock_nucleo = stock_nucleo + p_qty_returned where id = ei.item_id;
  return ei;
end; $$;

create or replace function public.close_event(p_event_id uuid)
returns public.events language plpgsql security definer set search_path = public as $$
declare e public.events; pend integer;
begin
  perform public._require_staff();
  select count(*) into pend from public.event_items where event_id = p_event_id and not coalesce(remito_llegada_ok, false);
  if pend > 0 then raise exception 'Hay % material(es) sin control de regreso', pend; end if;
  update public.events set status = 'cerrado', closed_at = now() where id = p_event_id and status = 'abierto' returning * into e;
  if not found then raise exception 'El evento no existe o ya está cerrado'; end if;
  return e;
end; $$;

-- Eliminar material: borra de verdad si nunca tuvo movimientos reales; si tiene historial lo ARCHIVA
-- (deja de verse, pero conserva el registro de quién movió qué). Para archivar el stock debe estar en 0.
create or replace function public.delete_item(p_item_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare it public.items; dstock integer; hist boolean;
begin
  perform public._require_staff();
  select * into it from public.items where id = p_item_id for update;
  if not found then raise exception 'Material inexistente'; end if;
  select coalesce(sum(qty),0) into dstock from public.destination_stock where item_id = p_item_id;
  if dstock > 0 then
    raise exception 'No se puede eliminar: hay % unidades en depósitos/puntos. Primero tienen que quedar en 0.', dstock;
  end if;
  hist := exists (select 1 from public.movements where item_id = p_item_id and type <> 'stock_inicial')
       or exists (select 1 from public.restocks where item_id = p_item_id)
       or exists (select 1 from public.withdrawals where item_id = p_item_id)
       or exists (select 1 from public.event_items where item_id = p_item_id);
  if not hist then
    delete from public.movements where item_id = p_item_id;
    delete from public.destination_stock where item_id = p_item_id;
    delete from public.items where id = p_item_id;
    return 'eliminado';
  end if;
  if it.stock_nucleo > 0 then
    raise exception 'No se puede eliminar con stock en Depo Central (%). Dejalo en 0 con un retiro o ajuste.', it.stock_nucleo;
  end if;
  update public.items set active = false where id = p_item_id;
  return 'archivado';
end; $$;

-- Cierra el acceso anónimo a las funciones
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in
             ('register_restock','register_withdrawal','send_to_destination','confirm_reception','register_point_withdrawal',
              'register_point_stock_in','set_point_min','adjust_stock','open_event','add_item_to_event','close_event_item',
              'close_event','delete_item','_require_staff') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Permisos de tabla: sin escritura directa del cliente salvo lo que habilitan las políticas
revoke delete on public.items from authenticated;
revoke insert, update, delete on public.movements, public.restocks, public.withdrawals, public.events,
                                 public.event_items, public.destination_stock from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------- Vista de restock por punto ----------
-- punto de restock = el mayor entre el mínimo cargado y lo que se consume en el tiempo de reposición (+30%)
create or replace view public.point_restock_status with (security_invoker = true) as
select ds.destination_id, d.name as destination_name, ds.item_id, i.name as item_name, i.category, i.brand,
       ds.qty, ds.min_qty,
       coalesce(o.out90, 0) as out_90d,
       round(coalesce(o.out90, 0) / 90.0, 2) as avg_daily,
       greatest(ds.min_qty, ceil(coalesce(o.out90, 0) / 90.0 * d.restock_lead_days * 1.3)::int) as restock_point,
       greatest(0, greatest(ceil(coalesce(o.out90, 0) / 90.0 * 30 * 1.3)::int,
                            greatest(ds.min_qty, ceil(coalesce(o.out90, 0) / 90.0 * d.restock_lead_days * 1.3)::int) * 2) - ds.qty) as suggested_qty,
       case when ds.qty <= 0 then 'sin_stock'
            when ds.qty <= greatest(ds.min_qty, ceil(coalesce(o.out90, 0) / 90.0 * d.restock_lead_days * 1.3)::int)
                 and greatest(ds.min_qty, ceil(coalesce(o.out90, 0) / 90.0 * d.restock_lead_days * 1.3)::int) > 0 then 'restock'
            else 'ok' end as status
from public.destination_stock ds
join public.destinations d on d.id = ds.destination_id
join public.items i on i.id = ds.item_id
left join lateral (
  select sum(m.qty) as out90 from public.movements m
  where m.origen_id = ds.destination_id and m.item_id = ds.item_id and m.type = 'entrega'
    and m.fecha >= current_date - 90) o on true;
grant select on public.point_restock_status to authenticated;

-- ---------- Realtime (re-ejecutable) ----------
do $$ declare t text; begin
  foreach t in array array['items','movements','destinations','restocks','withdrawals','events','event_items','destination_stock'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- ---------- 9. ADMIN ----------
-- Cambiá el mail si tu usuario es otro.
update public.profiles set role = 'admin'
 where id in (select id from auth.users where lower(email) in ('agarramone@neostar.com.ar','garramoneagustin@gmail.com'));

do $$ begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'No quedó ningún admin. Editá el mail en la sección 9 y volvé a correr (no se aplicó nada).';
  end if;
end $$;

-- ---------- 10. Asignar usuarios (correr aparte, con sus mails reales) ----------
-- update public.profiles set role='editor', full_name='Virginia Lottero' where lower(email)='vlottero@neostar.com.ar';
-- update public.profiles set role='editor', full_name='Santiago Linares' where lower(email)='slinares@neostar.com.ar';
-- update public.profiles set role='punto', full_name='Cañada (nfalcon)',
--        destination_id=(select id from public.destinations where name='Cañada de Gómez')
--  where lower(email)='nfalcon@neostar.com.ar';
