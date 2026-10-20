-- 012: regla de abastecimiento (quién abastece a cada destino) + envíos excepcionales con motivo.
-- Un destino con supplied_by_id NULL se abastece desde DEPOSITO MARKETING ROSARIO; si no, desde el depósito indicado.
-- Enviar fuera de esa regla solo lo puede hacer Marketing, como «Envío excepcional» con motivo obligatorio.
-- NOTA: en producción la parte de columnas y política se aplicó como 012a. La parte de create_shipment (con DROP FUNCTION)
-- queda en supabase/manual/A_pegar_antes_de_mergear.sql para correrla a mano en el SQL Editor.

alter table public.destinations
  add column if not exists supplied_by_id uuid references public.destinations(id);

do $$
declare v_sf uuid; n int;
begin
  select count(*) into n from public.destinations where supplies_dealers;
  if n <> 1 then raise exception 'Se esperaba exactamente 1 depósito con supplies_dealers = true (hay %)', n; end if;
  select id into v_sf from public.destinations where supplies_dealers;
  update public.destinations set supplied_by_id = v_sf where abastecido_por = 'deposito_sf' and id <> v_sf;
end $$;

create index if not exists destinations_supplied_by_id_idx on public.destinations(supplied_by_id);

alter table public.shipments add column if not exists exception_reason text;

-- Se eliminan las sobrecargas viejas para que PostgREST no tenga ambigüedad.
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

-- El depósito que envía también ve sus envíos (antes solo veía los que recibía)
alter policy shipments_select on public.shipments using (
  public.app_role() = any (array['admin','editor','viewer'])
  or (public.app_role() = 'punto' and (destination_id = public.app_destination() or origin_id = public.app_destination()))
);
