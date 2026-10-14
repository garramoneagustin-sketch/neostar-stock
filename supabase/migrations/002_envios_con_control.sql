-- =====================================================================
-- 002 · Envíos con lista de materiales y recepción con control (✓ / ✗)
-- Solo agrega cosas nuevas. No modifica ni borra datos existentes.
-- =====================================================================

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations(id),
  destination_name text,
  recipient_name text,
  notes text,
  status text not null default 'en_transito'
    check (status in ('en_transito','recibido','recibido_con_diferencias')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  received_by uuid,
  received_by_name text,
  received_at timestamptz,
  reception_notes text,
  reviewed boolean not null default false,
  reviewed_by_name text,
  reviewed_at timestamptz
);

alter table public.movements add column if not exists shipment_id uuid references public.shipments(id);
alter table public.movements add column if not exists reception_ok boolean;
alter table public.movements add column if not exists reception_note text;
create index if not exists movements_shipment_idx on public.movements(shipment_id);
create index if not exists shipments_dest_idx on public.shipments(destination_id, status);

alter table public.shipments enable row level security;
drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments for select to authenticated
  using (public.app_role() in ('admin','editor','viewer')
         or (public.app_role() = 'punto' and destination_id = public.app_destination()));
revoke insert, update, delete on public.shipments from anon, authenticated;
revoke all on public.shipments from anon;

-- Crear un envío con varios materiales (todo o nada). Descuenta del Depo Central y queda "en tránsito".
create or replace function public.create_shipment(p_destination_id uuid, p_items jsonb,
  p_recipient_name text default null, p_notes text default null)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare s public.shipments; d public.destinations; l record;
begin
  perform public._require_staff();
  select * into d from public.destinations where id = p_destination_id;
  if not found then raise exception 'Destino inexistente'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un material al envío';
  end if;
  perform set_config('app.stock_rpc','on',true);
  insert into public.shipments(destination_id, destination_name, recipient_name, notes, created_by, created_by_name)
  values (p_destination_id, d.name, nullif(trim(p_recipient_name),''), nullif(trim(p_notes),''), auth.uid(), public.app_person())
  returning * into s;
  for l in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::integer) as qty
      from jsonb_array_elements(p_items) e group by 1
  loop
    if l.qty is null or l.qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
    update public.items set stock_nucleo = stock_nucleo - l.qty
     where id = l.item_id and active and stock_nucleo >= l.qty;
    if not found then
      raise exception 'Stock insuficiente en Depo Central para "%"', coalesce((select name from public.items where id = l.item_id), 'material inexistente');
    end if;
    insert into public.movements(item_id, type, qty, fecha, origen, destino_id, destination, estado,
                                 recipient_name, person, created_by, notes, shipment_id)
    values (l.item_id, 'envio_destino', l.qty, current_date, 'Depo Central', p_destination_id, d.name, 'en_transito',
            nullif(trim(p_recipient_name),''), public.app_person(), auth.uid(), nullif(trim(p_notes),''), s.id);
  end loop;
  return s;
end; $$;

-- Recibir un envío controlando cada material. p_lines = [{movement_id, ok, qty_received, note}]
create or replace function public.receive_shipment(p_shipment_id uuid, p_lines jsonb, p_notes text default null)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare s public.shipments; m public.movements; ln jsonb; q integer; v_ok boolean; has_bad boolean := false;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'Envío inexistente'; end if;
  if s.status <> 'en_transito' then raise exception 'Este envío ya fue recibido'; end if;
  if not public.can_use_destination(s.destination_id) then raise exception 'No tenés permiso para recibir en este depósito'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'Falta el control de los materiales'; end if;

  for m in select * from public.movements where shipment_id = s.id order by created_at for update loop
    select e into ln from jsonb_array_elements(p_lines) e where (e->>'movement_id')::uuid = m.id limit 1;
    if ln is null or ln->>'ok' is null then
      raise exception 'Marcá ✓ o ✗ en "%"', (select name from public.items where id = m.item_id);
    end if;
    v_ok := (ln->>'ok')::boolean;
    if v_ok then q := m.qty;
    else
      has_bad := true;
      q := coalesce((ln->>'qty_received')::integer, 0);
      if q < 0 or q > m.qty then raise exception 'La cantidad recibida de "%" debe estar entre 0 y %',
        (select name from public.items where id = m.item_id), m.qty; end if;
    end if;
    if q > 0 then
      insert into public.destination_stock(destination_id, item_id, qty)
      values (s.destination_id, m.item_id, q)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    end if;
    update public.movements set
      estado = case when v_ok then 'recibido' else 'recibido_con_diferencia' end,
      qty_received = q, received_by = auth.uid(), received_by_name = public.app_person(), received_at = now(),
      reception_ok = v_ok, reception_note = nullif(trim(coalesce(ln->>'note','')),'')
    where id = m.id;
  end loop;

  if has_bad and coalesce(trim(p_notes),'') = '' then
    raise exception 'Contanos qué pasó en Observaciones (hay materiales marcados con ✗)';
  end if;

  update public.shipments set
    status = case when has_bad then 'recibido_con_diferencias' else 'recibido' end,
    received_by = auth.uid(), received_by_name = public.app_person(), received_at = now(),
    reception_notes = nullif(trim(coalesce(p_notes,'')),''),
    reviewed = not has_bad
  where id = s.id returning * into s;
  return s;
end; $$;

-- El admin marca como revisada una recepción con diferencias
create or replace function public.review_shipment(p_shipment_id uuid, p_note text default null)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare s public.shipments;
begin
  perform public._require_staff();
  update public.shipments set reviewed = true, reviewed_by_name = public.app_person(), reviewed_at = now(),
    notes = case when coalesce(trim(p_note),'') = '' then notes else coalesce(notes || ' · ', '') || 'Revisión: ' || trim(p_note) end
  where id = p_shipment_id returning * into s;
  if not found then raise exception 'Envío inexistente'; end if;
  return s;
end; $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_shipment','receive_shipment','review_shipment') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.shipments;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- =====================================================================
-- Eventos: fecha de inicio/fin, marca, lista de elementos con reserva de stock
-- Reservar NO descuenta stock: el stock sale recién cuando se entregan los materiales.
-- Disponible = stock del Depo Central - lo reservado por otros eventos abiertos que se pisan en fechas.
-- =====================================================================
alter table public.events add column if not exists start_date date;
alter table public.events add column if not exists end_date date;
alter table public.events add column if not exists brand text;
update public.events set start_date = event_date where start_date is null;
update public.events set end_date = event_date where end_date is null;

create or replace function public.item_available_for_event(p_item_id uuid, p_start date, p_end date, p_exclude_event uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select stock_nucleo from public.items where id = p_item_id), 0)
       - coalesce((select sum(ei.qty_allocated) from public.event_items ei join public.events e on e.id = ei.event_id
                    where ei.item_id = p_item_id and e.status = 'abierto' and ei.remito_salida_date is null
                      and (p_exclude_event is null or e.id <> p_exclude_event)
                      and coalesce(e.start_date, e.event_date) <= p_end and coalesce(e.end_date, e.event_date) >= p_start), 0)
$$;

create or replace function public.create_event(p_event_name text, p_start_date date, p_end_date date, p_brand text,
  p_items jsonb, p_carried_by text default null, p_notes text default null)
returns public.events language plpgsql security definer set search_path = public as $$
declare e public.events; l record; av integer;
begin
  perform public._require_staff();
  if coalesce(trim(p_event_name),'') = '' then raise exception 'Falta el nombre del evento'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'Falta la fecha de inicio o de fin'; end if;
  if p_end_date < p_start_date then raise exception 'La fecha de fin no puede ser anterior a la de inicio'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un elemento al evento';
  end if;
  insert into public.events(event_name, event_date, start_date, end_date, brand, carried_by, status, notes)
  values (trim(p_event_name), p_start_date, p_start_date, p_end_date, nullif(trim(p_brand),''), nullif(trim(p_carried_by),''), 'abierto', nullif(trim(p_notes),''))
  returning * into e;
  for l in select (x->>'item_id')::uuid as item_id, sum((x->>'qty')::integer) as qty from jsonb_array_elements(p_items) x group by 1 loop
    if l.qty is null or l.qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
    av := public.item_available_for_event(l.item_id, p_start_date, p_end_date, e.id);
    if l.qty > av then
      raise exception 'Solo hay % disponible(s) de "%" para esas fechas', greatest(av,0), coalesce((select name from public.items where id = l.item_id), 'material inexistente');
    end if;
    insert into public.event_items(event_id, item_id, qty_allocated) values (e.id, l.item_id, l.qty);
  end loop;
  return e;
end; $$;

-- Entregar los materiales del evento: ahí sí sale del Depo Central
create or replace function public.withdraw_event(p_event_id uuid, p_withdrawn_by text)
returns public.events language plpgsql security definer set search_path = public as $$
declare e public.events; ei record; n integer := 0;
begin
  perform public._require_staff();
  if coalesce(trim(p_withdrawn_by),'') = '' then raise exception 'Indicá quién retira los materiales'; end if;
  select * into e from public.events where id = p_event_id for update;
  if not found or e.status <> 'abierto' then raise exception 'El evento no existe o no está abierto'; end if;
  perform set_config('app.stock_rpc','on',true);
  for ei in select * from public.event_items where event_id = p_event_id and remito_salida_date is null for update loop
    update public.items set stock_nucleo = stock_nucleo - ei.qty_allocated where id = ei.item_id and stock_nucleo >= ei.qty_allocated;
    if not found then
      raise exception 'Stock insuficiente en Depo Central para "%"', (select name from public.items where id = ei.item_id);
    end if;
    update public.event_items set remito_salida_date = now(), remito_salida_signed_by = trim(p_withdrawn_by) where id = ei.id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Este evento no tiene materiales pendientes de entrega'; end if;
  return e;
end; $$;

create or replace function public.cancel_event(p_event_id uuid)
returns public.events language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  perform public._require_staff();
  if exists (select 1 from public.event_items where event_id = p_event_id and remito_salida_date is not null) then
    raise exception 'No se puede cancelar: ya se entregaron materiales. Registrá el regreso.';
  end if;
  update public.events set status = 'cancelado', closed_at = now() where id = p_event_id and status = 'abierto' returning * into e;
  if not found then raise exception 'El evento no existe o ya no está abierto'; end if;
  return e;
end; $$;

-- Regreso: solo se puede controlar lo que ya fue entregado
create or replace function public.close_event_item(p_event_item_id uuid, p_qty_returned integer,
  p_remito_llegada_date timestamptz, p_remito_llegada_signed_by text)
returns public.event_items language plpgsql security definer set search_path = public as $$
declare ei public.event_items;
begin
  perform public._require_staff();
  select * into ei from public.event_items where id = p_event_item_id for update;
  if not found then raise exception 'Registro inexistente'; end if;
  if ei.remito_salida_date is null then raise exception 'Este material todavía no fue entregado'; end if;
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

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_event','withdraw_event','cancel_event','close_event_item','item_available_for_event') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
