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
