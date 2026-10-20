-- ============================================================================
-- BLOQUE A — PEGAR EN SUPABASE (SQL Editor) ANTES DE MERGEAR EL PR DE LA RONDA 2
-- ============================================================================
-- Por qué a mano: la herramienta con la que trabaja Claude bloquea las sentencias DROP / DELETE,
-- y estas tres funciones las necesitan. Todo el resto de la ronda 2 ya está aplicado (migraciones 012–017a).
--
-- Cómo: Supabase → SQL Editor → New query → pegar TODO este archivo → Run.
-- Es seguro correrlo una vez. Al final hay 3 consultas de verificación (ver "Resultado esperado").
-- ============================================================================

-- 1) create_shipment: regla de abastecimiento + envíos excepcionales (migración 012)
--    Se borran las versiones viejas (4 y 5 argumentos) para que no haya ambigüedad.
drop function if exists public.create_shipment(uuid, jsonb, text, text);
drop function if exists public.create_shipment(uuid, jsonb, text, text, uuid);

create function public.create_shipment(
  p_destination_id uuid, p_items jsonb, p_recipient_name text default null, p_notes text default null,
  p_origin_id uuid default null, p_exception_reason text default null)
returns public.shipments
language plpgsql security definer set search_path to 'public'
as $function$
declare s public.shipments; d public.destinations; o public.destinations; l record; direct boolean;
        v_stock integer; v_res integer; nm text; org_name text; v_exc text; sup_name text;
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
  if not d.active then raise exception 'El destino «%» está inactivo', d.name; end if;
  if p_origin_id is not null then
    if p_origin_id = p_destination_id then raise exception 'El origen y el destino no pueden ser el mismo'; end if;
    if d.is_depot then raise exception 'Desde un depósito solo se envía a concesionarios'; end if;
  end if;

  -- Regla de abastecimiento (supplied_by_id NULL = lo abastece Rosario)
  v_exc := nullif(trim(coalesce(p_exception_reason, '')), '');
  if d.supplied_by_id is distinct from p_origin_id then
    if v_exc is null then
      select name into sup_name from public.destinations where id = d.supplied_by_id;
      raise exception '«%» se abastece desde %. Para enviar desde % marcá «Envío excepcional» y contá el motivo',
        d.name, coalesce(sup_name, 'DEPOSITO MARKETING ROSARIO'), org_name;
    end if;
    if not public.is_staff() then raise exception 'Solo Marketing puede hacer envíos excepcionales'; end if;
  else
    v_exc := null;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un material al envío';
  end if;
  direct := not d.is_depot;
  perform set_config('app.stock_rpc','on',true);
  insert into public.shipments(destination_id, destination_name, recipient_name, notes, created_by, created_by_name,
                               status, received_by, received_by_name, received_at, reviewed, origin_id, origin_name, exception_reason)
  values (p_destination_id, d.name, nullif(trim(p_recipient_name),''), nullif(trim(p_notes),''), auth.uid(), public.app_person(),
          case when direct then 'recibido' else 'en_transito' end,
          case when direct then auth.uid() end, case when direct then public.app_person() end,
          case when direct then now() end, direct, p_origin_id, org_name, v_exc)
  returning * into s;
  for l in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::integer)::integer as qty
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
            nullif(trim(p_recipient_name),''), public.app_person(), auth.uid(),
            nullif(concat_ws(' · ', nullif(trim(p_notes),''), case when v_exc is not null then 'Envío excepcional: ' || v_exc end), ''),
            s.id, case when direct then l.qty end, case when direct then true end);
    if direct then
      insert into public.destination_stock(destination_id, item_id, qty) values (p_destination_id, l.item_id, l.qty)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    end if;
  end loop;
  return s;
end; $function$;

revoke all on function public.create_shipment(uuid, jsonb, text, text, uuid, text) from public, anon;
grant execute on function public.create_shipment(uuid, jsonb, text, text, uuid, text) to authenticated;


-- 2) update_event: editar un evento abierto (nombre, fechas, responsable, notas y materiales aún no entregados)
create or replace function public.update_event(
  p_event_id uuid, p_event_name text, p_start_date date, p_end_date date, p_brand text,
  p_carried_by text, p_notes text, p_items jsonb)
returns public.events
language plpgsql security definer set search_path to 'public'
as $function$
declare e public.events; l record; av integer; delivered boolean; kept uuid[] := '{}'; nm text; cnt integer;
begin
  perform public._require_staff();
  select * into e from public.events where id = p_event_id for update;
  if not found or e.status <> 'abierto' then raise exception 'El evento no existe o ya no está abierto'; end if;
  if coalesce(trim(p_event_name),'') = '' then raise exception 'Falta el nombre del evento'; end if;
  if p_start_date is null or p_end_date is null then raise exception 'Falta la fecha de inicio o de fin'; end if;
  if p_end_date < p_start_date then raise exception 'La fecha de fin no puede ser anterior a la de inicio'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Faltan los elementos del evento'; end if;
  delivered := exists (select 1 from public.event_items where event_id = p_event_id and remito_salida_date is not null);
  if delivered and coalesce(nullif(trim(p_brand),''),'') is distinct from coalesce(e.brand,'') then
    raise exception 'Ya se entregaron materiales: no se puede cambiar la marca del evento';
  end if;
  update public.events set event_name = trim(p_event_name), event_date = p_start_date, start_date = p_start_date, end_date = p_end_date,
         brand = nullif(trim(p_brand),''), carried_by = nullif(trim(p_carried_by),''), notes = nullif(trim(p_notes),'')
   where id = p_event_id;
  for l in select (x->>'item_id')::uuid as item_id, sum((x->>'qty')::integer)::integer as qty
             from jsonb_array_elements(p_items) x group by 1 loop
    select name into nm from public.items where id = l.item_id;
    if nm is null then raise exception 'Material inexistente'; end if;
    if l.qty is null or l.qty <= 0 then raise exception 'La cantidad de "%" debe ser mayor a cero', nm; end if;
    if exists (select 1 from public.event_items where event_id = p_event_id and item_id = l.item_id and remito_salida_date is not null) then
      continue;  -- lo ya entregado no se toca
    end if;
    av := public.item_available_for_event(l.item_id, p_start_date, p_end_date, p_event_id);
    if l.qty > av then raise exception 'Solo hay % disponible(s) de "%" para esas fechas', greatest(av,0), nm; end if;
    if exists (select 1 from public.event_items where event_id = p_event_id and item_id = l.item_id) then
      update public.event_items set qty_allocated = l.qty where event_id = p_event_id and item_id = l.item_id;
    else
      insert into public.event_items(event_id, item_id, qty_allocated) values (p_event_id, l.item_id, l.qty);
    end if;
    kept := kept || l.item_id;
  end loop;
  delete from public.event_items where event_id = p_event_id and remito_salida_date is null and not (item_id = any (kept));
  select count(*) into cnt from public.event_items where event_id = p_event_id;
  if cnt = 0 then raise exception 'El evento tiene que tener al menos un elemento'; end if;
  select * into e from public.events where id = p_event_id;
  return e;
end; $function$;
revoke all on function public.update_event(uuid, text, date, date, text, text, text, jsonb) from public, anon;
grant execute on function public.update_event(uuid, text, date, date, text, text, text, jsonb) to authenticated;


-- 3) Archivar un material solo se puede hacer con «Eliminar» (que deja registro), no editando la fila a mano.
--    También se saca de la protección del stock las columnas viejas total_qty y danados.
create or replace function public.guard_item_stock()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.stock_rpc', true), '') <> 'on' then
    if new.stock_nucleo is distinct from old.stock_nucleo then
      raise exception 'El stock no se edita directo: usá Ingreso, Retiro, Movimiento o Ajuste (así queda registro).';
    end if;
    if old.active and not new.active then
      raise exception 'Para archivar un material usá «Eliminar» (así queda registro).';
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $function$;

create or replace function public.delete_item(p_item_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $function$
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
    raise exception 'No se puede eliminar con stock en DEPOSITO MARKETING ROSARIO (%). Dejalo en 0 con un retiro o ajuste.', it.stock_nucleo;
  end if;
  perform set_config('app.stock_rpc','on',true);
  update public.items set active = false where id = p_item_id;
  return 'archivado';
end; $function$;


-- ============================================================================
-- VERIFICACIÓN (correr después, deben dar lo indicado)
-- ============================================================================
-- (a) Debe devolver UNA sola fila, con 6 argumentos:
select pg_get_function_identity_arguments(oid) as argumentos_create_shipment
  from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_shipment';
-- (b) Debe devolver update_event:
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'update_event';
-- (c) Debe devolver "true" (el guard nuevo menciona 'archivar'):
select position('archivar' in pg_get_functiondef('public.guard_item_stock'::regproc)) > 0 as guard_actualizado;
