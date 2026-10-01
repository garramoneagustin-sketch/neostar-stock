-- NEOSTAR STOCK SYSTEM - SCHEMA COMPLETO
-- Ejecutar en Supabase SQL Editor

-- ========== EXTENSIONES ==========
create extension if not exists pgcrypto;

-- ========== TABLAS EXISTENTES - VERIFICAR ==========
-- profiles, destinations, items, movements (revisadas arriba)

-- ========== NUEVAS TABLAS ==========

-- Tabla: INGRESOS/RECOMPRA
create table if not exists public.restocks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  qty integer not null check (qty > 0),
  source text not null check (source in ('proveedor', 'devolucion', 'ajuste')),
  cost numeric,
  person text,
  created_at timestamp with time zone default now(),
  notes text
);

alter table public.restocks enable row level security;
create policy "authenticated read restocks" on public.restocks for select to authenticated using (true);
create policy "authenticated manage restocks" on public.restocks for insert to authenticated with check (true);

-- Tabla: RETIROS/USO INTERNO
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  qty integer not null check (qty > 0),
  reason_type text not null check (reason_type in ('regalo_corporativo', 'incidencia_cliente', 'uso_interno', 'otro')),
  reason_detail text,
  recipient_last_name text,
  vehicle_plate text,
  person text,
  created_at timestamp with time zone default now(),
  notes text
);

alter table public.withdrawals enable row level security;
create policy "authenticated read withdrawals" on public.withdrawals for select to authenticated using (true);
create policy "authenticated manage withdrawals" on public.withdrawals for insert to authenticated with check (true);

-- Tabla: EVENTOS
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  event_date date not null,
  trello_id text,
  carried_by text,
  status text not null default 'abierto' check (status in ('abierto', 'cerrado', 'cancelado')),
  notes text,
  created_at timestamp with time zone default now(),
  closed_at timestamp with time zone
);

alter table public.events enable row level security;
create policy "authenticated read events" on public.events for select to authenticated using (true);
create policy "authenticated manage events" on public.events for all to authenticated using (true);

-- Tabla: ITEMS DE EVENTO (detalle de qué se lleva)
create table if not exists public.event_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  qty_allocated integer not null check (qty_allocated > 0),
  qty_returned integer default 0 check (qty_returned >= 0),
  qty_used integer generated always as (qty_allocated - coalesce(qty_returned, 0)) stored,
  remito_salida_date timestamp with time zone,
  remito_salida_signed_by text,
  remito_llegada_date timestamp with time zone,
  remito_llegada_signed_by text,
  remito_llegada_ok boolean default false,
  created_at timestamp with time zone default now()
);

alter table public.event_items enable row level security;
create policy "authenticated read event_items" on public.event_items for select to authenticated using (true);
create policy "authenticated manage event_items" on public.event_items for all to authenticated using (true);

-- ========== ACTUALIZAR COLUMNAS EN ITEMS ==========
alter table public.items add column if not exists sku text;
alter table public.items add column if not exists subcategory text;
alter table public.items add column if not exists occasion text;
alter table public.items add column if not exists scope text default 'generico';
alter table public.items add column if not exists brand text;
alter table public.items add column if not exists stock_nucleo integer default 0;
alter table public.items add column if not exists stock_sf integer default 0;
alter table public.items add column if not exists stock_canada integer default 0;
alter table public.items add column if not exists stock_funes integer default 0;
alter table public.items add column if not exists reorder_nucleo integer default 0;
alter table public.items add column if not exists reorder_sf integer default 0;
alter table public.items add column if not exists lead_time_days integer default 0;

create unique index if not exists items_sku_unique on public.items(sku) where sku is not null and sku <> '';

-- ========== ÍNDICES PARA PERFORMANCE ==========
create index if not exists restocks_item_id on public.restocks(item_id);
create index if not exists restocks_created_at on public.restocks(created_at desc);
create index if not exists withdrawals_item_id on public.withdrawals(item_id);
create index if not exists withdrawals_created_at on public.withdrawals(created_at desc);
create index if not exists events_status on public.events(status);
create index if not exists events_event_date on public.events(event_date);
create index if not exists event_items_event_id on public.event_items(event_id);
create index if not exists event_items_remito_llegada_ok on public.event_items(remito_llegada_ok);

-- ========== FUNCIONES ==========

-- Función: Actualizar stock al registrar ingreso
create or replace function public.register_restock(
  p_item_id uuid,
  p_qty integer,
  p_source text,
  p_cost numeric default null,
  p_person text default null,
  p_notes text default null
) returns public.restocks language plpgsql security invoker as $$
declare r public.restocks;
begin
  if p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  insert into public.restocks(item_id, qty, source, cost, person, notes)
  values(p_item_id, p_qty, p_source, p_cost, p_person, p_notes)
  returning * into r;
  update public.items set stock_nucleo = stock_nucleo + p_qty where id = p_item_id;
  return r;
end; $$;

-- Función: Registrar retiro/uso
create or replace function public.register_withdrawal(
  p_item_id uuid,
  p_qty integer,
  p_reason_type text,
  p_reason_detail text default null,
  p_recipient_last_name text default null,
  p_vehicle_plate text default null,
  p_person text default null,
  p_notes text default null
) returns public.withdrawals language plpgsql security invoker as $$
declare r public.withdrawals;
begin
  if p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if p_reason_type = 'incidencia_cliente' then
    if coalesce(trim(p_recipient_last_name), '') = '' or coalesce(trim(p_vehicle_plate), '') = '' then
      raise exception 'Para incidencia con cliente, apellido y patente son obligatorios';
    end if;
  end if;
  
  insert into public.withdrawals(item_id, qty, reason_type, reason_detail, recipient_last_name, vehicle_plate, person, notes)
  values(p_item_id, p_qty, p_reason_type, p_reason_detail, p_recipient_last_name, p_vehicle_plate, p_person, p_notes)
  returning * into r;
  
  update public.items set stock_nucleo = stock_nucleo - p_qty where id = p_item_id;
  return r;
end; $$;

-- Función: Registrar movimiento a otro depósito
create or replace function public.register_movement_transfer(
  p_item_id uuid,
  p_qty integer,
  p_destination text,
  p_recipient_name text default null,
  p_person text default null,
  p_notes text default null
) returns public.movements language plpgsql security invoker as $$
declare r public.movements;
begin
  if p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  
  insert into public.movements(item_id, type, qty, origin, destination, person, notes)
  values(p_item_id, 'transfer', p_qty, 'Depo Central', p_destination, p_person, p_notes)
  returning * into r;
  
  update public.items set stock_nucleo = stock_nucleo - p_qty where id = p_item_id;
  
  -- Si el destino es Santa Fe, Cañada o Funes, sumar al stock respectivo
  if p_destination = 'Santa Fe' then
    update public.items set stock_sf = stock_sf + p_qty where id = p_item_id;
  elsif p_destination = 'Cañada de Gómez' then
    update public.items set stock_canada = stock_canada + p_qty where id = p_item_id;
  elsif p_destination = 'Funes' then
    update public.items set stock_funes = stock_funes + p_qty where id = p_item_id;
  end if;
  
  return r;
end; $$;

-- Función: Abrir evento (remito de salida)
create or replace function public.open_event(
  p_event_name text,
  p_event_date date,
  p_carried_by text,
  p_trello_id text default null,
  p_notes text default null
) returns public.events language plpgsql security invoker as $$
declare e public.events;
begin
  insert into public.events(event_name, event_date, carried_by, trello_id, status, notes)
  values(p_event_name, p_event_date, p_carried_by, p_trello_id, 'abierto', p_notes)
  returning * into e;
  return e;
end; $$;

-- Función: Agregar items al evento
create or replace function public.add_item_to_event(
  p_event_id uuid,
  p_item_id uuid,
  p_qty_allocated integer,
  p_remito_salida_date timestamp with time zone,
  p_remito_salida_signed_by text
) returns public.event_items language plpgsql security invoker as $$
declare ei public.event_items;
begin
  if p_qty_allocated <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  
  insert into public.event_items(event_id, item_id, qty_allocated, remito_salida_date, remito_salida_signed_by)
  values(p_event_id, p_item_id, p_qty_allocated, p_remito_salida_date, p_remito_salida_signed_by)
  returning * into ei;
  
  update public.items set stock_nucleo = stock_nucleo - p_qty_allocated where id = p_item_id;
  
  return ei;
end; $$;

-- Función: Cerrar remito de llegada (devolución)
create or replace function public.close_event_item(
  p_event_item_id uuid,
  p_qty_returned integer,
  p_remito_llegada_date timestamp with time zone,
  p_remito_llegada_signed_by text
) returns public.event_items language plpgsql security invoker as $$
declare ei public.event_items;
begin
  if p_qty_returned < 0 then raise exception 'La cantidad no puede ser negativa'; end if;
  
  update public.event_items
  set qty_returned = p_qty_returned,
      remito_llegada_date = p_remito_llegada_date,
      remito_llegada_signed_by = p_remito_llegada_signed_by,
      remito_llegada_ok = true
  where id = p_event_item_id
  returning * into ei;
  
  update public.items set stock_nucleo = stock_nucleo + p_qty_returned where id = ei.item_id;
  
  return ei;
end; $$;

-- Función: Cerrar evento completamente
create or replace function public.close_event(
  p_event_id uuid
) returns public.events language plpgsql security invoker as $$
declare e public.events;
begin
  update public.events
  set status = 'cerrado',
      closed_at = now()
  where id = p_event_id
  returning * into e;
  return e;
end; $$;

-- ========== REALTIMESYNC ==========
alter publication supabase_realtime add table public.restocks;
alter publication supabase_realtime add table public.withdrawals;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.event_items;

-- ========== SEED DATA: Destinos actualizados ==========
delete from public.destinations where name like '%Demo%' or name like '%test%';

insert into public.destinations(name, abastecido_por, marcas) values
('Santa Fe', 'nucleo', array['Nissan', 'Kia', 'BYD', 'Jeep', 'RAM', 'Honda', 'Suzuki', 'Subaru']),
('Cañada de Gómez', 'nucleo', array['Nissan', 'Kia', 'BYD']),
('Funes', 'nucleo', array['Jeep', 'RAM', 'Honda']),
('Nissan Rosario', 'nucleo', array['Nissan']),
('Kia Rosario', 'nucleo', array['Kia']),
('BYD Rosario', 'nucleo', array['BYD']),
('Jeep Rosario', 'nucleo', array['Jeep']),
('RAM Rosario', 'nucleo', array['RAM']),
('Honda Rosario', 'nucleo', array['Honda']),
('Suzuki Rosario', 'nucleo', array['Suzuki']),
('Subaru Rosario', 'nucleo', array['Subaru'])
on conflict (name) do nothing;
