-- 018: cambios de la auditoría de uso (ronda 3).
--  · Ingresos con varios materiales (register_restocks) agrupados por batch_id
--  · Conteo físico: ajusta todo un depósito de una vez, dejando registradas solo las diferencias (register_stock_count)
--  · Importación de materiales desde planilla (import_materials)
--  · Avisos de recompra del depósito Rosario con el consumo de los últimos 90 días (central_restock_status)
--  · No permite crear dos materiales con el mismo nombre y la misma marca (los que ya estaban duplicados no se tocan)
--  · Los registros viejos que mostraban el mail de quien los cargó pasan a mostrar su nombre
-- No contiene DROP ni DELETE.

-- ---------------------------------------------------------------------------
-- 1) Ingresos con varios materiales
-- ---------------------------------------------------------------------------
alter table public.restocks add column if not exists batch_id uuid;
create index if not exists restocks_batch_idx on public.restocks(batch_id);

create or replace function public.register_restocks(p_lines jsonb, p_source text, p_notes text default null)
returns setof public.restocks
language plpgsql security definer set search_path to 'public'
as $function$
declare l record; r public.restocks; v_batch uuid := gen_random_uuid();
begin
  perform public._require_staff();
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Agregá al menos un material al ingreso';
  end if;
  for l in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::integer)::integer as qty,
           sum(nullif(e->>'cost','')::numeric) as cost
      from jsonb_array_elements(p_lines) e group by 1
  loop
    r := public.register_restock(l.item_id, l.qty, p_source, l.cost, null::text, p_notes);
    update public.restocks set batch_id = v_batch where id = r.id returning * into r;
    return next r;
  end loop;
  return;
end; $function$;
revoke all on function public.register_restocks(jsonb, text, text) from public, anon;
grant execute on function public.register_restocks(jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Conteo físico: una sola operación; solo se registran los materiales cuya cantidad cambió
-- ---------------------------------------------------------------------------
create or replace function public.register_stock_count(p_destination_id uuid, p_lines jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare l record; cur integer; n_adj integer := 0; n_same integer := 0; v_reason text;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'El motivo del conteo es obligatorio'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'No hay cantidades contadas para registrar';
  end if;
  if p_destination_id is null then
    perform public._require_staff();
  elsif not public.can_use_destination(p_destination_id) then
    raise exception 'No tenés permiso sobre este depósito';
  end if;
  v_reason := 'Conteo físico: ' || trim(p_reason);
  for l in
    select (e->>'item_id')::uuid as item_id, (e->>'counted')::integer as counted
      from jsonb_array_elements(p_lines) e
  loop
    if l.counted is null or l.counted < 0 then raise exception 'Hay una cantidad contada inválida'; end if;
    cur := null;
    if p_destination_id is null then
      select stock_nucleo into cur from public.items where id = l.item_id;
    else
      select coalesce((select qty from public.destination_stock where destination_id = p_destination_id and item_id = l.item_id), 0) into cur;
    end if;
    if cur is null then raise exception 'Material inexistente'; end if;
    if cur = l.counted then
      n_same := n_same + 1;
    else
      perform public.adjust_stock(l.item_id, p_destination_id, l.counted, v_reason);
      n_adj := n_adj + 1;
    end if;
  end loop;
  return jsonb_build_object('adjusted', n_adj, 'unchanged', n_same);
end; $function$;
revoke all on function public.register_stock_count(uuid, jsonb, text) from public, anon;
grant execute on function public.register_stock_count(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Importar materiales desde planilla. Solo CREA: lo que ya existe no se pisa (así importar dos veces no duplica stock).
--    Filas: { name, category, brand, destination, qty, min }
-- ---------------------------------------------------------------------------
create or replace function public.import_materials(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  e jsonb; n integer := 0; v_name text; v_cat text; v_kind text; v_brand text; v_dest_txt text; v_dest uuid;
  v_qty integer; v_min integer; v_item uuid; v_created integer := 0; v_loaded integer := 0; v_skipped jsonb := '[]'::jsonb;
  v_cnt integer; v_cur integer;
  brands text[] := array['Genérico','Kia','Jeep','RAM','Nissan','BYD','Suzuki','Subaru','Honda','Neostar'];
begin
  perform public._require_staff();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'La planilla no tiene filas para importar';
  end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Importá de a 500 filas como máximo'; end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    v_name := trim(coalesce(e->>'name', ''));
    if v_name = '' then raise exception 'Fila %: falta el nombre del material', n; end if;
    v_cat := trim(coalesce(e->>'category', ''));
    select kind into v_kind from public.categories where active and lower(name) = lower(v_cat);
    if v_kind is null then raise exception 'Fila % («%»): la categoría «%» no existe', n, v_name, v_cat; end if;
    select name into v_cat from public.categories where active and lower(name) = lower(trim(e->>'category'));
    v_brand := coalesce(nullif(trim(e->>'brand'), ''), 'Genérico');
    select b into v_brand from unnest(brands) b where lower(b) = lower(v_brand);
    if v_brand is null then raise exception 'Fila % («%»): la marca «%» no es válida', n, v_name, e->>'brand'; end if;
    begin
      v_qty := coalesce(nullif(trim(e->>'qty'), '')::integer, 0);
      v_min := coalesce(nullif(trim(e->>'min'), '')::integer, 0);
    exception when others then
      raise exception 'Fila % («%»): la cantidad y el mínimo tienen que ser números enteros', n, v_name;
    end;
    if v_qty < 0 or v_min < 0 then raise exception 'Fila % («%»): no puede haber cantidades negativas', n, v_name; end if;

    v_dest_txt := lower(trim(coalesce(e->>'destination', '')));
    v_dest := null;
    if v_dest_txt not in ('', 'rosario', 'deposito rosario', 'depósito rosario', 'deposito marketing rosario', 'depósito marketing rosario') then
      select count(*), min(id::text)::uuid into v_cnt, v_dest from public.destinations
       where is_depot and lower(name) like '%' || v_dest_txt || '%';
      if v_cnt <> 1 then
        raise exception 'Fila % («%»): el depósito «%» no se reconoce (usá Rosario, Santa Fe o Cañada de Gómez)', n, v_name, e->>'destination';
      end if;
    end if;

    select id into v_item from public.items
     where active and lower(trim(name)) = lower(v_name) and coalesce(brand, 'Genérico') = v_brand limit 1;

    if v_dest is null then
      if v_item is not null then
        v_skipped := v_skipped || jsonb_build_object('row', n, 'name', v_name, 'reason', 'Ya existe: no se cambia su stock en Rosario');
      else
        insert into public.items(name, kind, category, brand, stock_nucleo, reorder_nucleo, lead_time_days)
        values (v_name, v_kind, v_cat, v_brand, v_qty, v_min, 15);
        v_created := v_created + 1; v_loaded := v_loaded + 1;
      end if;
    else
      if v_item is null then
        insert into public.items(name, kind, category, brand, stock_nucleo, reorder_nucleo, lead_time_days)
        values (v_name, v_kind, v_cat, v_brand, 0, 0, 15) returning id into v_item;
        v_created := v_created + 1;
      end if;
      select coalesce(qty, 0) into v_cur from public.destination_stock where destination_id = v_dest and item_id = v_item;
      if coalesce(v_cur, 0) > 0 then
        v_skipped := v_skipped || jsonb_build_object('row', n, 'name', v_name, 'reason', 'Ya tiene stock en ese depósito: no se pisa');
      else
        insert into public.destination_stock(destination_id, item_id, qty, min_qty) values (v_dest, v_item, v_qty, v_min)
        on conflict (destination_id, item_id) do update set qty = excluded.qty, min_qty = excluded.min_qty, updated_at = now();
        if v_qty > 0 then
          insert into public.movements(item_id, type, qty, fecha, destino_id, destination, estado, person, created_by, notes)
          values (v_item, 'ingreso_punto', v_qty, current_date, v_dest, (select name from public.destinations where id = v_dest), 'recibido',
                  public.app_person(), auth.uid(), 'Carga inicial desde planilla');
        end if;
        v_loaded := v_loaded + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('rows', n, 'created', v_created, 'loaded', v_loaded, 'skipped', v_skipped);
end; $function$;
revoke all on function public.import_materials(jsonb) from public, anon;
grant execute on function public.import_materials(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Aviso de recompra del depósito Rosario con el consumo real de los últimos 90 días
--    (retiros + envíos que salieron de Rosario + consumo en eventos). Mismo criterio que point_restock_status.
-- ---------------------------------------------------------------------------
create or replace view public.central_restock_status with (security_invoker = true) as
with base as (
  select i.id as item_id, i.name as item_name, i.category, i.brand, i.stock_nucleo as qty, i.reorder_nucleo as min_qty,
         coalesce(nullif(i.lead_time_days, 0), 15) as lead_days,
         (coalesce((select sum(w.qty) from public.withdrawals w where w.item_id = i.id and w.created_at >= now() - interval '90 days'), 0)
        + coalesce((select sum(m.qty) from public.movements m
                     where m.item_id = i.id and m.created_at >= now() - interval '90 days'
                       and ((m.type = 'envio_destino' and m.origen_id is null) or m.type = 'consumo_evento')), 0))::bigint as out_90d
    from public.items i
   where i.active and i.kind = 'consumible'
), calc as (
  select b.*, round(b.out_90d::numeric / 90.0, 2) as avg_daily,
         greatest(b.min_qty, ceil(b.out_90d::numeric / 90.0 * b.lead_days * 1.3)::integer) as restock_point
    from base b
)
select item_id, item_name, category, brand, qty, min_qty, out_90d, avg_daily, restock_point,
       greatest(0, greatest(ceil(avg_daily * 30 * 1.3)::integer, restock_point * 2) - qty) as suggested_qty,
       case when qty <= 0 and (out_90d > 0 or min_qty > 0) then 'sin_stock'
            when restock_point > 0 and qty <= restock_point then 'restock'
            else 'ok' end as status
  from calc;
revoke all on public.central_restock_status from public, anon;
grant select on public.central_restock_status to authenticated;

-- ---------------------------------------------------------------------------
-- 5) No crear dos materiales iguales (mismo nombre y misma marca). Solo se controla al crear o al cambiar nombre/marca,
--    así los que ya estaban repetidos se pueden seguir editando.
-- ---------------------------------------------------------------------------
create or replace function public.items_no_duplicates()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare b text := coalesce(nullif(trim(new.brand), ''), 'Genérico');
begin
  if tg_op = 'UPDATE'
     and lower(trim(new.name)) = lower(trim(old.name))
     and coalesce(nullif(trim(new.brand), ''), 'Genérico') = coalesce(nullif(trim(old.brand), ''), 'Genérico')
     and new.active is not distinct from old.active then
    return new;
  end if;
  if new.active and exists (
    select 1 from public.items x
     where x.active and x.id <> new.id and lower(trim(x.name)) = lower(trim(new.name))
       and coalesce(nullif(trim(x.brand), ''), 'Genérico') = b
  ) then
    raise exception 'Ya existe el material «%» de la marca %. Si es el mismo, editá el que ya está; si es otro producto, cambiale el nombre.', trim(new.name), b;
  end if;
  return new;
end; $function$;
create or replace trigger items_no_duplicates before insert or update of name, brand, active on public.items
  for each row execute function public.items_no_duplicates();

-- ---------------------------------------------------------------------------
-- 6) Una sola forma de mostrar al usuario: el nombre (los registros viejos guardaron el mail)
-- ---------------------------------------------------------------------------
update public.movements m set person = p.full_name from public.profiles p where m.person = p.email and coalesce(p.full_name, '') <> '';
update public.restocks r set person = p.full_name from public.profiles p where r.person = p.email and coalesce(p.full_name, '') <> '';
update public.withdrawals w set person = p.full_name from public.profiles p where w.person = p.email and coalesce(p.full_name, '') <> '';
update public.shipments s set created_by_name = p.full_name from public.profiles p where s.created_by_name = p.email and coalesce(p.full_name, '') <> '';
update public.shipments s set received_by_name = p.full_name from public.profiles p where s.received_by_name = p.email and coalesce(p.full_name, '') <> '';
update public.shipments s set reviewed_by_name = p.full_name from public.profiles p where s.reviewed_by_name = p.email and coalesce(p.full_name, '') <> '';
