-- =====================================================================
-- 007 · Diferencias entre envío y recepción: se registran, generan alerta y se resuelven material por material.
-- Antes: si se enviaban 10 y llegaban 8, las 2 faltantes desaparecían sin registro.
-- Ahora: motivo obligatorio al recibir, estado «con_diferencia» (alerta) y resolución solo para admin/editor.
-- =====================================================================

alter table public.movements add column if not exists diff_reason text;      -- faltante | danado | otro_material | de_mas
alter table public.movements add column if not exists pending_qty integer not null default 0;     -- unidades de diferencia sin explicar
alter table public.movements add column if not exists in_transit_qty integer not null default 0;  -- unidades que siguen en camino (próximo envío)

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'movements_diff_reason_check') then
    alter table public.movements add constraint movements_diff_reason_check
      check (diff_reason is null or diff_reason in ('faltante','danado','otro_material','de_mas'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'movements_pending_nonneg') then
    alter table public.movements add constraint movements_pending_nonneg check (pending_qty >= 0 and in_transit_qty >= 0);
  end if;
end $$;

alter table public.shipments drop constraint if exists shipments_status_check;
alter table public.shipments add constraint shipments_status_check
  check (status in ('en_transito','parcial','con_diferencia','recibido','recibido_con_diferencias'));

-- Recalcula el estado del envío a partir de sus líneas
create or replace function public._refresh_shipment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pend integer; v_tr integer; v_diff boolean; st text;
begin
  select coalesce(sum(pending_qty),0), coalesce(sum(in_transit_qty),0), coalesce(bool_or(diff_reason is not null),false)
    into v_pend, v_tr, v_diff
    from public.movements where shipment_id = p_id and type = 'envio_destino';
  st := case when v_pend > 0 then 'con_diferencia'
             when v_tr > 0 then 'parcial'
             when v_diff then 'recibido_con_diferencias'
             else 'recibido' end;
  update public.shipments set status = st, reviewed = (st in ('recibido','recibido_con_diferencias')) where id = p_id;
end; $$;

-- Recibir un envío. p_lines = [{movement_id, ok, qty_received, reason, note}]
create or replace function public.receive_shipment(p_shipment_id uuid, p_lines jsonb, p_notes text default null)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare s public.shipments; m public.movements; ln jsonb; v_ok boolean; v_exp integer; q integer;
        v_reason text; v_good integer; v_pend integer; nm text; v_ok_all boolean;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'Envío inexistente'; end if;
  if s.status not in ('en_transito','parcial') then
    raise exception 'Este envío ya fue recibido o tiene una diferencia pendiente de resolver';
  end if;
  if not public.can_use_destination(s.destination_id) then raise exception 'No tenés permiso para recibir en este depósito'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'Falta el control de los materiales'; end if;

  for m in select * from public.movements where shipment_id = s.id and type = 'envio_destino' order by created_at for update loop
    v_exp := case when s.status = 'en_transito' then m.qty else m.in_transit_qty end;
    if v_exp <= 0 then continue; end if;
    select name || coalesce(' · ' || nullif(brand,''), '') into nm from public.items where id = m.item_id;
    select e into ln from jsonb_array_elements(p_lines) e where (e->>'movement_id')::uuid = m.id limit 1;
    if ln is null or ln->>'ok' is null then raise exception 'Marcá ✓ o ✗ en "%"', nm; end if;
    v_ok := (ln->>'ok')::boolean;
    v_reason := null;
    if v_ok then
      v_good := v_exp; v_pend := 0;
    else
      v_reason := ln->>'reason';
      if v_reason is null or v_reason not in ('faltante','danado','otro_material','de_mas') then
        raise exception 'Elegí el motivo de la diferencia en "%"', nm;
      end if;
      q := coalesce(nullif(ln->>'qty_received','')::integer, 0);
      if q < 0 then raise exception 'La cantidad de "%" no puede ser negativa', nm; end if;
      if v_reason = 'de_mas' then
        if q <= v_exp then raise exception 'Si llegó de más, la cantidad que llegó de "%" tiene que ser mayor a % (lo enviado)', nm, v_exp; end if;
        v_good := v_exp; v_pend := q - v_exp;
      else
        if q >= v_exp then raise exception 'La cantidad que llegó de "%" tiene que ser menor a %. Si llegó todo bien, marcá ✓', nm, v_exp; end if;
        v_good := q; v_pend := v_exp - q;
      end if;
    end if;
    if v_good > 0 then
      insert into public.destination_stock(destination_id, item_id, qty)
      values (s.destination_id, m.item_id, v_good)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    end if;
    v_ok_all := coalesce(m.reception_ok, true) and v_ok;
    update public.movements set
      qty_received = coalesce(qty_received, 0) + v_good,
      pending_qty = v_pend, in_transit_qty = 0,
      diff_reason = coalesce(v_reason, diff_reason),
      reception_ok = v_ok_all,
      reception_note = coalesce(nullif(trim(coalesce(ln->>'note','')),''), reception_note),
      received_by = auth.uid(), received_by_name = public.app_person(), received_at = now(),
      estado = case when v_pend > 0 then 'con_diferencia' when v_ok_all then 'recibido' else 'recibido_con_diferencia' end
    where id = m.id;
  end loop;

  update public.shipments set
    received_by = auth.uid(), received_by_name = public.app_person(), received_at = now(),
    reception_notes = coalesce(nullif(trim(coalesce(p_notes,'')),''), reception_notes)
  where id = s.id;
  perform public._refresh_shipment(s.id);
  select * into s from public.shipments where id = s.id;
  return s;
end; $$;

-- Resolver diferencias (solo admin/editor). p_resolutions = [{movement_id, action, qty, note}]
-- action: proximo_envio | no_salio | perdida | error_conteo | sobrante (este último solo si llegó de más)
create or replace function public.resolve_shipment_difference(p_shipment_id uuid, p_resolutions jsonb)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare s public.shipments; r jsonb; m public.movements; v_act text; v_qty integer; v_note text; nm text; v_stock integer;
begin
  perform public._require_staff();
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'Envío inexistente'; end if;
  if s.status <> 'con_diferencia' then raise exception 'Este envío no tiene diferencias pendientes'; end if;
  if p_resolutions is null or jsonb_typeof(p_resolutions) <> 'array' or jsonb_array_length(p_resolutions) = 0 then
    raise exception 'Elegí qué pasó con las unidades de diferencia';
  end if;
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
      update public.items set stock_nucleo = stock_nucleo + v_qty where id = m.item_id;
    elsif v_act = 'error_conteo' then
      insert into public.destination_stock(destination_id, item_id, qty) values (s.destination_id, m.item_id, v_qty)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    elsif v_act = 'sobrante' then
      select stock_nucleo into v_stock from public.items where id = m.item_id for update;
      if coalesce(v_stock,0) < v_qty then
        raise exception 'No hay stock suficiente en DEPOSITO MARKETING ROSARIO para descontar el sobrante de "%". Ajustá ese stock primero', nm;
      end if;
      update public.items set stock_nucleo = stock_nucleo - v_qty where id = m.item_id;
      insert into public.destination_stock(destination_id, item_id, qty) values (s.destination_id, m.item_id, v_qty)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    end if;

    update public.movements set pending_qty = pending_qty - v_qty,
           in_transit_qty = in_transit_qty + case when v_act = 'proximo_envio' then v_qty else 0 end
     where id = m.id;

    insert into public.movements(item_id, type, qty, fecha, origen, destino_id, destination, estado,
                                 reason_type, reason_detail, notes, person, created_by, shipment_id)
    values (m.item_id, 'resolucion_diferencia', v_qty, current_date, 'DEPOSITO MARKETING ROSARIO', s.destination_id, s.destination_name,
            v_act, v_act, v_note, v_note, public.app_person(), auth.uid(), s.id);
  end loop;

  update public.movements set
    estado = case when pending_qty > 0 then 'con_diferencia' when in_transit_qty > 0 then 'parcial' else 'recibido_con_diferencia' end
   where shipment_id = s.id and type = 'envio_destino' and diff_reason is not null;
  perform public._refresh_shipment(s.id);
  update public.shipments set reviewed_by_name = public.app_person(), reviewed_at = now() where id = s.id;
  select * into s from public.shipments where id = s.id;
  return s;
end; $$;

-- «Revisar» ya no existe: una diferencia se cierra solo resolviéndola
revoke execute on function public.review_shipment(uuid, text) from authenticated;
revoke all on function public._refresh_shipment(uuid) from public, anon, authenticated;
revoke all on function public.receive_shipment(uuid, jsonb, text) from public, anon;
grant execute on function public.receive_shipment(uuid, jsonb, text) to authenticated;
revoke all on function public.resolve_shipment_difference(uuid, jsonb) from public, anon;
grant execute on function public.resolve_shipment_difference(uuid, jsonb) to authenticated;
