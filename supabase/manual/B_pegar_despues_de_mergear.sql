-- ============================================================================
-- BLOQUE B — pegar en el SQL Editor de Supabase DESPUÉS de mergear el PR y de haber corrido el bloque A.
-- Es limpieza y endurecimiento: la plataforma funciona igual sin esto, pero conviene hacerlo.
-- Contiene DROP, por eso no se puede aplicar desde el asistente: se pega acá a mano.
-- Cada parte es independiente. Si una falla, las demás se pueden correr igual.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Fotos: límite de 5 MB y solo JPG/PNG/WebP + poder borrar fotos quitadas desde la plataforma
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'item-photos';

drop policy if exists item_photos_delete on storage.objects;
create policy item_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and public.app_role() = any (array['admin', 'editor']));

-- ---------------------------------------------------------------------------
-- 2) Funciones viejas que ya nadie usa (la plataforma usa create_shipment, receive_shipment,
--    resolve_shipment_difference, create_event, etc.). Dejarlas es una puerta de entrada de más.
-- ---------------------------------------------------------------------------
drop function if exists public.send_to_destination(uuid, uuid, integer, text, text);
drop function if exists public.confirm_reception(uuid, integer, text);
drop function if exists public.register_movement(uuid, text, integer, date, text);
drop function if exists public.register_movement(uuid, text, integer, date, text, text, text, text, text, text, text);
drop function if exists public.open_event(text, date, text, text, text);
drop function if exists public.add_item_to_event(uuid, uuid, integer, timestamptz, text);
drop function if exists public.review_shipment(uuid, text);

-- _require_staff solo la usan funciones SECURITY DEFINER (corren con permisos del dueño de la función):
-- nadie necesita poder llamarla desde afuera.
revoke execute on function public._require_staff() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Columnas viejas de materiales (del esquema anterior, por depósito fijo). Verificado: ninguna
--    función ni vista las usa. Se conservan occasion, reorder_nucleo y lead_time_days.
-- ---------------------------------------------------------------------------
alter table public.items
  drop column if exists stock_sf,
  drop column if exists stock_canada,
  drop column if exists stock_funes,
  drop column if exists reorder_sf,
  drop column if exists ocasion,
  drop column if exists total_qty,
  drop column if exists danados,
  drop column if exists default_min;

-- ---------------------------------------------------------------------------
-- 4) Destinos: separar la política «para todo» en insertar / modificar / borrar (misma regla: solo admin)
-- ---------------------------------------------------------------------------
drop policy if exists destinations_write on public.destinations;
create policy destinations_insert on public.destinations for insert to authenticated with check (public.app_role() = 'admin');
create policy destinations_update on public.destinations for update to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy destinations_delete on public.destinations for delete to authenticated using (public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 5) (MÁS ADELANTE, no ahora) La columna destinations.abastecido_por quedó reemplazada por supplied_by_id.
--    Cuando confirmes que todo anda bien algunas semanas, se puede borrar con:
--      alter table public.destinations drop column abastecido_por;
-- ---------------------------------------------------------------------------

-- ============================================================================
-- Verificación (cada una debería dar lo que dice):
-- ============================================================================
-- Debe dar 5242880:
select file_size_limit from storage.buckets where id = 'item-photos';
-- Debe dar 0 filas (funciones viejas borradas):
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('send_to_destination','confirm_reception','register_movement','open_event','add_item_to_event','review_shipment');
-- Debe dar 0 filas (columnas viejas borradas):
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'items'
  and column_name in ('stock_sf','stock_canada','stock_funes','reorder_sf','ocasion','total_qty','danados','default_min');
-- Debe mostrar destinations_insert, destinations_update, destinations_delete y destinations_select:
select policyname from pg_policies where schemaname = 'public' and tablename = 'destinations' order by 1;
