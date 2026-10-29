-- 014: resolver diferencias de un envío contra el origen real (Rosario o un depósito), no siempre Rosario.
-- Si el envío salió de un depósito (shipments.origin_id), «no salió» devuelve el material a ese depósito y
-- «sobrante» se descuenta de ese depósito. El movimiento de resolución registra el origen correcto.

create or replace function public.resolve_shipment_difference(p_shipment_id uuid, p_resolutions jsonb)
returns public.shipments
language plpgsql security definer set search_path to 'public'
as $function$
declare s public.shipments; r jsonb; m public.movements; v_act text; v_qty integer; v_note text; nm text; v_stock integer; org text;
begin
  perform public._require_staff();
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'Envío inexistente'; end if;
  if s.status <> 'con_diferencia' then raise exception 'Este envío no tiene diferencias pendientes'; end if;
  if p_resolutions is null or jsonb_typeof(p_resolutions) <> 'array' or jsonb_array_length(p_resolutions) = 0 then
    raise exception 'Elegí qué pasó con las unidades de diferencia';
  end if;
  org := coalesce(s.origin_name, 'DEPOSITO MARKETING ROSARIO');
  perform set_config('app.stock_rpc','on',true);

  for r in select e from jsonb_array_elements(p_resolutions) e loop
    select * into m from public.movements
     where id = (r->>'movement_id')::uuid and shipment_id = s.id and type = 'envio_destino' for update;
    if not found then raise exception 'Ese material no pertenece a este envío'; end if;
    select name || coalesce(' · ' || nullif(brand,''), '') into nm from public.items where id = m.item_id;
    v_act := r->>'action';
    v_qty := nullif(r->>'qty','')::integer;
    v_note := nullif(trim(coalesce(r->>'note','')),'');
    if v_act is null or v_act not in ('proximo_envio','no_salio','perdida','error_conteo','sobrante') then
      raise exception 'Elegí qué pasó con "%"', nm;
    end if;
    if v_qty is null or v_qty <= 0 then raise exception 'La cantidad de "%" debe ser mayor a cero', nm; end if;
    if v_qty > m.pending_qty then raise exception 'Solo quedan % unidad(es) sin explicar de "%"', m.pending_qty, nm; end if;
    if (m.diff_reason = 'de_mas') <> (v_act = 'sobrante') then
      raise exception 'Esa opción no corresponde a la diferencia de "%"', nm;
    end if;
    if v_act = 'perdida' and v_note is null then raise exception 'Contá el motivo de la pérdida de "%"', nm; end if;

    if v_act = 'no_salio' then
      if s.origin_id is null then
        update public.items set stock_nucleo = stock_nucleo + v_qty where id = m.item_id;
      else
        insert into public.destination_stock(destination_id, item_id, qty) values (s.origin_id, m.item_id, v_qty)
        on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
      end if;
    elsif v_act = 'error_conteo' then
      insert into public.destination_stock(destination_id, item_id, qty) values (s.destination_id, m.item_id, v_qty)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    elsif v_act = 'sobrante' then
      if s.origin_id is null then
        select stock_nucleo into v_stock from public.items where id = m.item_id for update;
      else
        select qty into v_stock from public.destination_stock where destination_id = s.origin_id and item_id = m.item_id for update;
      end if;
      if coalesce(v_stock,0) < v_qty then
        raise exception 'No hay stock suficiente en % para descontar el sobrante de "%". Ajustá ese stock primero', org, nm;
      end if;
      if s.origin_id is null then
        update public.items set stock_nucleo = stock_nucleo - v_qty where id = m.item_id;
      else
        update public.destination_stock set qty = qty - v_qty, updated_at = now()
         where destination_id = s.origin_id and item_id = m.item_id;
      end if;
      insert into public.destination_stock(destination_id, item_id, qty) values (s.destination_id, m.item_id, v_qty)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    end if;

    update public.movements set pending_qty = pending_qty - v_qty,
           in_transit_qty = in_transit_qty + case when v_act = 'proximo_envio' then v_qty else 0 end
     where id = m.id;

    insert into public.movements(item_id, type, qty, fecha, origen, origen_id, destino_id, destination, estado,
                                 reason_type, reason_detail, notes, person, created_by, shipment_id)
    values (m.item_id, 'resolucion_diferencia', v_qty, current_date, org, s.origin_id, s.destination_id, s.destination_name,
            v_act, v_act, v_note, v_note, public.app_person(), auth.uid(), s.id);
  end loop;

  update public.movements set
    estado = case when pending_qty > 0 then 'con_diferencia' when in_transit_qty > 0 then 'parcial' else 'recibido_con_diferencia' end
   where shipment_id = s.id and type = 'envio_destino' and diff_reason is not null;
  perform public._refresh_shipment(s.id);
  update public.shipments set reviewed_by_name = public.app_person(), reviewed_at = now() where id = s.id;
  select * into s from public.shipments where id = s.id;
  return s;
end; $function$;
