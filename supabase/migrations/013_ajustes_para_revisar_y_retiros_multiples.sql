-- 013: (a) los ajustes que hace un usuario de depósito quedan "para revisar" hasta que Marketing los marca como vistos;
--      (b) retiros de varios materiales en una sola operación (atómico).
-- Aplicada en partes 013a y 013b.

-- (a) Ajustes para revisar
alter table public.movements
  add column if not exists needs_review boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_name text;

create index if not exists movements_needs_review_idx on public.movements(created_at) where needs_review;

create or replace function public.adjust_stock(p_item_id uuid, p_destination_id uuid, p_new_qty integer, p_reason text)
returns public.movements
language plpgsql security definer set search_path to 'public'
as $function$
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
    if not found then raise exception 'Depósito inexistente'; end if;
    select qty into cur from public.destination_stock where destination_id = p_destination_id and item_id = p_item_id for update;
    cur := coalesce(cur, 0);
    if cur = p_new_qty then raise exception 'El stock ya es %', cur; end if;
    insert into public.destination_stock(destination_id, item_id, qty) values (p_destination_id, p_item_id, p_new_qty)
    on conflict (destination_id, item_id) do update set qty = excluded.qty, updated_at = now();
    insert into public.movements(item_id, type, qty, fecha, origen, origen_id, estado, reason_type, reason_detail, person, created_by, notes,
                                 qty_before, qty_after, needs_review)
    values (p_item_id, 'ajuste', abs(p_new_qty - cur), current_date, d.name, p_destination_id, 'ajustado', 'ajuste', p_reason,
            public.app_person(), auth.uid(), format('Stock %s → %s', cur, p_new_qty), cur, p_new_qty, not public.is_staff())
    returning * into r;
  end if;
  return r;
end; $function$;

create or replace function public.ack_movement(p_movement_id uuid)
returns public.movements
language plpgsql security definer set search_path to 'public'
as $function$
declare r public.movements;
begin
  perform public._require_staff();
  update public.movements set needs_review = false, reviewed_at = now(), reviewed_by_name = public.app_person()
   where id = p_movement_id and needs_review
  returning * into r;
  if not found then raise exception 'Ese movimiento no está pendiente de revisión'; end if;
  return r;
end; $function$;
revoke all on function public.ack_movement(uuid) from public, anon;
grant execute on function public.ack_movement(uuid) to authenticated;

-- (b) Retiros con varios materiales
alter table public.withdrawals add column if not exists batch_id uuid;
create index if not exists withdrawals_batch_id_idx on public.withdrawals(batch_id);

create or replace function public.register_withdrawals(
  p_lines jsonb, p_reason_type text, p_reason_detail text default null,
  p_recipient_last_name text default null, p_vehicle_plate text default null, p_notes text default null)
returns setof public.withdrawals
language plpgsql security definer set search_path to 'public'
as $function$
declare l record; r public.withdrawals; v_batch uuid := gen_random_uuid();
begin
  perform public._require_staff();
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Agregá al menos un material al retiro';
  end if;
  if coalesce(trim(p_reason_detail),'') = '' then raise exception 'La descripción del retiro es obligatoria'; end if;
  for l in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::integer)::integer as qty
      from jsonb_array_elements(p_lines) e group by 1
  loop
    r := public.register_withdrawal(l.item_id, l.qty, p_reason_type, p_reason_detail, p_recipient_last_name, p_vehicle_plate, null::text, p_notes);
    update public.withdrawals set batch_id = v_batch where id = r.id returning * into r;
    return next r;
  end loop;
  return;
end; $function$;
revoke all on function public.register_withdrawals(jsonb, text, text, text, text, text) from public, anon;
grant execute on function public.register_withdrawals(jsonb, text, text, text, text, text) to authenticated;
