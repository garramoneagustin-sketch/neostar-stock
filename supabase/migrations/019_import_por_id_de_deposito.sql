-- 019: la importación de materiales acepta el id del depósito (la pantalla lo manda ya resuelto, así no depende del texto del nombre).

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
    if nullif(e->>'destination_id', '') is not null then
      -- la pantalla manda el id del depósito que ya reconoció
      select id into v_dest from public.destinations where id = (e->>'destination_id')::uuid and is_depot;
      if v_dest is null then raise exception 'Fila % («%»): el depósito no existe', n, v_name; end if;
    elsif v_dest_txt not in ('', 'rosario', 'deposito rosario', 'depósito rosario', 'deposito marketing rosario', 'depósito marketing rosario') then
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
