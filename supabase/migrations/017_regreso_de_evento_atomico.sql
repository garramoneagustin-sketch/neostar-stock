-- 017: registrar el regreso de un evento en una sola operación atómica.
-- Antes la app llamaba a close_event_item una vez por material y después a close_event: si una línea fallaba,
-- las anteriores ya habían movido stock y el evento quedaba a medias.
-- (update_event, que permite editar un evento abierto, está en supabase/manual/A_pegar_antes_de_mergear.sql
--  porque contiene un DELETE.)

create or replace function public.return_event(p_event_id uuid, p_returns jsonb, p_signed_by text default null)
returns public.events
language plpgsql security definer set search_path to 'public'
as $function$
declare r record; e public.events;
begin
  perform public._require_staff();
  if p_returns is null or jsonb_typeof(p_returns) <> 'array' or jsonb_array_length(p_returns) = 0 then
    raise exception 'No hay materiales para registrar el regreso';
  end if;
  for r in
    select (x->>'event_item_id')::uuid as id, (x->>'qty_returned')::integer as qty
      from jsonb_array_elements(p_returns) x
  loop
    if not exists (select 1 from public.event_items where id = r.id and event_id = p_event_id) then
      raise exception 'Ese material no pertenece a este evento';
    end if;
    perform public.close_event_item(r.id, r.qty, null, nullif(trim(coalesce(p_signed_by,'')), ''));
  end loop;
  e := public.close_event(p_event_id);
  return e;
end; $function$;
revoke all on function public.return_event(uuid, jsonb, text) from public, anon;
grant execute on function public.return_event(uuid, jsonb, text) to authenticated;
