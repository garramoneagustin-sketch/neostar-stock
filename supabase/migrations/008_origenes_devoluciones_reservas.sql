-- =====================================================================
-- 008 · Etapa 2: envíos desde el depósito de Santa Fe, devoluciones a Rosario, reservas de eventos que bloquean
--       envíos y retiros, "Cargar stock" solo para admin/editor, ajustes con antes/después y eventos en el Historial.
-- =====================================================================

alter table public.destinations add column if not exists supplies_dealers boolean not null default false; -- puede enviar a concesionarios desde su stock
update public.destinations set supplies_dealers = true where id = 'b64042df-fb2e-47df-9242-771901c2debb'; -- DEPOSITO MARKETING SANTA FE
alter table public.shipments add column if not exists origin_id uuid references public.destinations(id);
alter table public.shipments add column if not exists origin_name text;
alter table public.movements add column if not exists qty_before integer;
alter table public.movements add column if not exists qty_after integer;

-- ---------- Reservas: unidades comprometidas en eventos abiertos que todavía no salieron ----------
-- Se cuenta el pico de reservas simultáneas (dos eventos en fechas distintas pueden reutilizar el mismo material).
create or replace function public.item_reserved(p_item_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  with ev as (
    select coalesce(e.start_date, e.event_date) as s, coalesce(e.end_date, e.event_date) as en, ei.qty_allocated as q
      from public.event_items ei join public.events e on e.id = ei.event_id
     where ei.item_id = p_item_id and e.status = 'abierto' and ei.remito_salida_date is null
       and coalesce(e.end_date, e.event_date) >= current_date
  )
  select coalesce(max(t.tot), 0)::integer from (
    select (select sum(e2.q) from ev e2 where e2.s <= greatest(e1.s, current_date) and e2.en >= greatest(e1.s, current_date)) as tot
      from ev e1
  ) t
$$;

create or replace function public.reserved_by_item()
returns table(item_id uuid, reserved integer) language sql stable security definer set search_path = public as $$
  select i.item_id, public.item_reserved(i.item_id)
    from (select distinct ei.item_id from public.event_items ei join public.events e on e.id = ei.event_id
           where e.status = 'abierto' and ei.remito_salida_date is null) i
   where public.app_role() in ('admin','editor','viewer')
$$;

-- ---------- Envíos: origen DEPOSITO MARKETING ROSARIO (por defecto) o un depósito que abastece concesionarios ----------
-- La versión vieja de 4 parámetros queda sin acceso (se borra en la etapa 4); la app siempre envía p_origin_id.
create or replace function public.create_shipment(p_destination_id uuid, p_items jsonb,
  p_recipient_name text default null, p_notes text default null, p_origin_id uuid default null)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare s public.shipments; d public.destinations; o public.destinations; l record; direct boolean;
        v_stock integer; v_res integer; nm text; org_name text;
begin
  if p_origin_id is null then
    perform public._require_staff();
    org_name := 'DEPOSITO MARKETING ROSARIO';
  else
    select * into o from public.destinations where id = p_origin_id;
    if not found then raise exception 'Origen inexistente'; end if;
    if not o.supplies_dealers then raise exception 'Ese depósito no envía a concesionarios'; end if;
    if not public.can_use_destination(p_origin_id) then raise exception 'No tenés permiso sobre ese depósito'; end if;
    org_name := o.name;
  end if;
  select * into d from public.destinations where id = p_destination_id;
  if not found then raise exception 'Destino inexistente'; end if;
  if p_origin_id is not null then
    if p_origin_id = p_destination_id then raise exception 'El origen y el destino no pueden ser el mismo'; end if;
    if d.is_depot then raise exception 'Desde un depósito solo se envía a concesionarios'; end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un material al envío';
  end if;
  -- is_depot = el destino usa la plataforma y controla la recepción. Los demás concesionarios: solo registro.
  direct := not d.is_depot;
  perform set_config('app.stock_rpc','on',true);
  insert into public.shipments(destination_id, destination_name, recipient_name, notes, created_by, created_by_name,
                               status, received_by, received_by_name, received_at, reviewed, origin_id, origin_name)
  values (p_destination_id, d.name, nullif(trim(p_recipient_name),''), nullif(trim(p_notes),''), auth.uid(), public.app_person(),
          case when direct then 'recibido' else 'en_transito' end,
          case when direct then auth.uid() end, case when direct then public.app_person() end,
          case when direct then now() end, direct, p_origin_id, org_name)
  returning * into s;
  for l in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::integer) as qty
      from jsonb_array_elements(p_items) e group by 1
  loop
    if l.qty is null or l.qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
    select name || coalesce(' · ' || nullif(brand,''), '') into nm from public.items where id = l.item_id;
    if nm is null then raise exception 'Material inexistente'; end if;
    if p_origin_id is null then
      select stock_nucleo into v_stock from public.items where id = l.item_id and active for update;
      if not found then raise exception 'El material "%" no está activo', nm; end if;
      v_res := public.item_reserved(l.item_id);
      if v_stock < l.qty then
        raise exception 'Stock insuficiente en DEPOSITO MARKETING ROSARIO para "%" (hay %)', nm, v_stock;
      elsif v_stock - v_res < l.qty then
        raise exception 'No se puede enviar % de "%": hay % en DEPOSITO MARKETING ROSARIO pero % están reservados para eventos (disponible: %)',
          l.qty, nm, v_stock, v_res, greatest(v_stock - v_res, 0);
      end if;
      update public.items set stock_nucleo = stock_nucleo - l.qty where id = l.item_id;
    else
      update public.destination_stock set qty = qty - l.qty, updated_at = now()
       where destination_id = p_origin_id and item_id = l.item_id and qty >= l.qty;
      if not found then raise exception 'Stock insuficiente en % para "%"', org_name, nm; end if;
    end if;
    insert into public.movements(item_id, type, qty, fecha, origen, origen_id, destino_id, destination, estado,
                                 recipient_name, person, created_by, notes, shipment_id, qty_received, reception_ok)
    values (l.item_id, 'envio_destino', l.qty, current_date, org_name, p_origin_id, p_destination_id, d.name,
            case when direct then 'recibido' else 'en_transito' end,
            nullif(trim(p_recipient_name),''), public.app_person(), auth.uid(), nullif(trim(p_notes),''), s.id,
            case when direct then l.qty end, case when direct then true end);
    if direct then
      insert into public.destination_stock(destination_id, item_id, qty) values (p_destination_id, l.item_id, l.qty)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    end if;
  end loop;
  return s;
end; $$;

-- ---------- Devolución a DEPOSITO MARKETING ROSARIO: descuenta en el origen y suma en Rosario (solo admin/editor) ----------
create or replace function public.register_return(p_destination_id uuid, p_item_id uuid, p_qty integer, p_notes text default null)
returns public.movements language plpgsql security definer set search_path = public as $$
declare r public.movements; d public.destinations; nm text;
begin
  perform public._require_staff();
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  select * into d from public.destinations where id = p_destination_id;
  if not found then raise exception 'Depósito o concesionario inexistente'; end if;
  select name || coalesce(' · ' || nullif(brand,''), '') into nm from public.items where id = p_item_id;
  if nm is null then raise exception 'Material inexistente'; end if;
  perform set_config('app.stock_rpc','on',true);
  update public.destination_stock set qty = qty - p_qty, updated_at = now()
   where destination_id = p_destination_id and item_id = p_item_id and qty >= p_qty;
  if not found then raise exception 'Stock insuficiente en % para devolver "%"', d.name, nm; end if;
  update public.items set stock_nucleo = stock_nucleo + p_qty where id = p_item_id;
  insert into public.movements(item_id, type, qty, fecha, origen, origen_id, destination, estado, person, created_by, notes)
  values (p_item_id, 'devolucion', p_qty, current_date, d.name, p_destination_id, 'DEPOSITO MARKETING ROSARIO', 'recibido',
          public.app_person(), auth.uid(), nullif(trim(p_notes),'')) returning * into r;
  return r;
end; $$;

-- ---------- Cargar stock en un depósito: solo admin/editor y con motivo (NO es para envíos de Rosario) ----------
create or replace function public.register_point_stock_in(p_destination_id uuid, p_item_id uuid, p_qty integer, p_notes text default null)
returns public.movements language plpgsql security definer set search_path = public as $$
declare r public.movements; d public.destinations;
begin
  perform public._require_staff();
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if coalesce(trim(p_notes),'') = '' then
    raise exception 'Contá el motivo de la carga (no es para envíos de Rosario: esos se reciben desde "En camino")';
  end if;
  select * into d from public.destinations where id = p_destination_id;
  if not found then raise exception 'Destino inexistente'; end if;
  insert into public.destination_stock(destination_id, item_id, qty) values (p_destination_id, p_item_id, p_qty)
  on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
  insert into public.movements(item_id, type, qty, fecha, destino_id, destination, estado, person, created_by, notes)
  values (p_item_id, 'ingreso_punto', p_qty, current_date, p_destination_id, d.name, 'recibido', public.app_person(), auth.uid(), trim(p_notes))
  returning * into r;
  return r;
end; $$;

-- ---------- Ingresos a Rosario: las devoluciones tienen su propio flujo ----------
create or replace function public.register_restock(p_item_id uuid, p_qty integer, p_source text, p_cost numeric default null,
  p_person text default null, p_notes text default null)
returns public.restocks language plpgsql security definer set search_path = public as $$
declare r public.restocks;
begin
  perform public._require_staff();
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if lower(coalesce(p_source,'')) like 'devoluci%' then
    raise exception 'Las devoluciones se registran desde Depósitos y puntos → «Devolver a Rosario», así también se descuentan de donde vuelven';
  end if;
  if p_source is null or p_source not in ('proveedor','otro') then raise exception 'Elegí el origen del ingreso (proveedor u otro)'; end if;
  if p_cost is not null and p_cost < 0 then raise exception 'El costo no puede ser negativo'; end if;
  perform set_config('app.stock_rpc','on',true);
  update public.items set stock_nucleo = stock_nucleo + p_qty where id = p_item_id;
  if not found then raise exception 'Material inexistente'; end if;
  insert into public.restocks(item_id, qty, source, cost, person, notes)
  values (p_item_id, p_qty, p_source, p_cost, public.app_person(), p_notes) returning * into r;
  return r;
end; $$;

-- ---------- Retiros: respetan lo reservado para eventos ----------
create or replace function public.register_withdrawal(p_item_id uuid, p_qty integer, p_reason_type text, p_reason_detail text default null,
  p_recipient_last_name text default null, p_vehicle_plate text default null, p_person text default null, p_notes text default null)
returns public.withdrawals language plpgsql security definer set search_path = public as $$
declare r public.withdrawals; v_stock integer; v_res integer; nm text;
begin
  perform public._require_staff();
  if p_qty is null or p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if p_reason_type is null or p_reason_type not in ('regalo_corporativo','incidencia_cliente','uso_interno','otro') then
    raise exception 'Elegí el motivo del retiro';
  end if;
  if p_reason_type = 'incidencia_cliente'
     and (coalesce(trim(p_recipient_last_name),'') = '' or coalesce(trim(p_vehicle_plate),'') = '') then
    raise exception 'Para incidencia con cliente, apellido y patente son obligatorios';
  end if;
  perform set_config('app.stock_rpc','on',true);
  select stock_nucleo, name || coalesce(' · ' || nullif(brand,''), '') into v_stock, nm from public.items where id = p_item_id for update;
  if not found then raise exception 'Material inexistente'; end if;
  v_res := public.item_reserved(p_item_id);
  if v_stock < p_qty then raise exception 'Stock insuficiente en DEPOSITO MARKETING ROSARIO para "%" (hay %)', nm, v_stock; end if;
  if v_stock - v_res < p_qty then
    raise exception 'No se puede retirar % de "%": hay % en DEPOSITO MARKETING ROSARIO pero % están reservados para eventos (disponible: %)',
      p_qty, nm, v_stock, v_res, greatest(v_stock - v_res, 0);
  end if;
  update public.items set stock_nucleo = stock_nucleo - p_qty where id = p_item_id;
  insert into public.withdrawals(item_id, qty, reason_type, reason_detail, recipient_last_name, vehicle_plate, person, notes)
  values (p_item_id, p_qty, p_reason_type, p_reason_detail, p_recipient_last_name, p_vehicle_plate, public.app_person(), p_notes)
  returning * into r;
  return r;
end; $$;

-- ---------- Ajustes: queda el antes y el después ----------
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
    insert into public.movements(item_id, type, qty, fecha, origen, estado, reason_type, reason_detail, person, created_by, notes, qty_before, qty_after)
    values (p_item_id, 'ajuste', abs(p_new_qty - cur), current_date, 'DEPOSITO MARKETING ROSARIO', 'ajustado', 'ajuste', p_reason,
            public.app_person(), auth.uid(), format('Stock %s → %s', cur, p_new_qty), cur, p_new_qty) returning * into r;
  else
    if not public.can_use_destination(p_destination_id) then raise exception 'No tenés permiso sobre este depósito'; end if;
    select * into d from public.destinations where id = p_destination_id;
    select qty into cur from public.destination_stock where destination_id = p_destination_id and item_id = p_item_id for update;
    cur := coalesce(cur, 0);
    if cur = p_new_qty then raise exception 'El stock ya es %', cur; end if;
    insert into public.destination_stock(destination_id, item_id, qty) values (p_destination_id, p_item_id, p_new_qty)
    on conflict (destination_id, item_id) do update set qty = excluded.qty, updated_at = now();
    insert into public.movements(item_id, type, qty, fecha, origen, origen_id, estado, reason_type, reason_detail, person, created_by, notes, qty_before, qty_after)
    values (p_item_id, 'ajuste', abs(p_new_qty - cur), current_date, d.name, p_destination_id, 'ajustado', 'ajuste', p_reason,
            public.app_person(), auth.uid(), format('Stock %s → %s', cur, p_new_qty), cur, p_new_qty) returning * into r;
  end if;
  return r;
end; $$;

-- ---------- Eventos: la salida, el regreso y lo consumido quedan en el Historial ----------
create or replace function public.withdraw_event(p_event_id uuid, p_withdrawn_by text)
returns public.events language plpgsql security definer set search_path = public as $$
declare e public.events; ei record; n integer := 0; nm text;
begin
  perform public._require_staff();
  if coalesce(trim(p_withdrawn_by),'') = '' then raise exception 'Indicá quién retira los materiales'; end if;
  select * into e from public.events where id = p_event_id for update;
  if not found or e.status <> 'abierto' then raise exception 'El evento no existe o no está abierto'; end if;
  perform set_config('app.stock_rpc','on',true);
  for ei in select * from public.event_items where event_id = p_event_id and remito_salida_date is null for update loop
    update public.items set stock_nucleo = stock_nucleo - ei.qty_allocated where id = ei.item_id and stock_nucleo >= ei.qty_allocated;
    if not found then
      select name || coalesce(' · ' || nullif(brand,''), '') into nm from public.items where id = ei.item_id;
      raise exception 'Stock insuficiente en DEPOSITO MARKETING ROSARIO para "%"', nm;
    end if;
    update public.event_items set remito_salida_date = now(), remito_salida_signed_by = trim(p_withdrawn_by) where id = ei.id;
    insert into public.movements(item_id, type, qty, fecha, origen, destination, estado, person, created_by, notes)
    values (ei.item_id, 'salida_evento', ei.qty_allocated, current_date, 'DEPOSITO MARKETING ROSARIO', e.event_name, 'entregado',
            public.app_person(), auth.uid(), 'Evento: ' || e.event_name || ' · retira ' || trim(p_withdrawn_by));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Este evento no tiene materiales pendientes de entrega'; end if;
  return e;
end; $$;

create or replace function public.close_event_item(p_event_item_id uuid, p_qty_returned integer,
  p_remito_llegada_date timestamp with time zone, p_remito_llegada_signed_by text)
returns public.event_items language plpgsql security definer set search_path = public as $$
declare ei public.event_items; ev_name text; v_used integer;
begin
  perform public._require_staff();
  select * into ei from public.event_items where id = p_event_item_id for update;
  if not found then raise exception 'Registro inexistente'; end if;
  if ei.remito_salida_date is null then raise exception 'Este material todavía no fue entregado'; end if;
  if ei.remito_llegada_ok then raise exception 'Este material ya fue controlado al regreso'; end if;
  if p_qty_returned is null or p_qty_returned < 0 or p_qty_returned > ei.qty_allocated then
    raise exception 'La cantidad devuelta debe estar entre 0 y % (lo que salió)', ei.qty_allocated;
  end if;
  v_used := ei.qty_allocated - p_qty_returned;
  perform set_config('app.stock_rpc','on',true);
  update public.event_items set qty_returned = p_qty_returned,
         remito_llegada_date = coalesce(p_remito_llegada_date, now()),
         remito_llegada_signed_by = p_remito_llegada_signed_by, remito_llegada_ok = true
   where id = p_event_item_id returning * into ei;
  update public.items set stock_nucleo = stock_nucleo + p_qty_returned where id = ei.item_id;
  select event_name into ev_name from public.events where id = ei.event_id;
  if p_qty_returned > 0 then
    insert into public.movements(item_id, type, qty, fecha, origen, destination, estado, person, created_by, notes)
    values (ei.item_id, 'retorno_evento', p_qty_returned, current_date, ev_name, 'DEPOSITO MARKETING ROSARIO', 'recibido',
            public.app_person(), auth.uid(), 'Evento: ' || ev_name);
  end if;
  if v_used > 0 then
    insert into public.movements(item_id, type, qty, fecha, origen, estado, person, created_by, notes)
    values (ei.item_id, 'consumo_evento', v_used, current_date, ev_name, 'entregado',
            public.app_person(), auth.uid(), 'No volvió (se consumió o se perdió) · Evento: ' || ev_name);
  end if;
  return ei;
end; $$;

-- ---------- Permisos ----------
revoke all on function public.item_reserved(uuid) from public, anon;
grant execute on function public.item_reserved(uuid) to authenticated;
revoke all on function public.reserved_by_item() from public, anon;
grant execute on function public.reserved_by_item() to authenticated;
revoke all on function public.create_shipment(uuid, jsonb, text, text, uuid) from public, anon;
grant execute on function public.create_shipment(uuid, jsonb, text, text, uuid) to authenticated;
revoke all on function public.register_return(uuid, uuid, integer, text) from public, anon;
grant execute on function public.register_return(uuid, uuid, integer, text) to authenticated;

revoke all on function public.create_shipment(uuid, jsonb, text, text) from public, anon, authenticated;
