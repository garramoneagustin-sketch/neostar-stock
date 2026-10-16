-- 011: validaciones en el servidor, índices, seguridad y cuentas nuevas sin acceso hasta que un admin las apruebe.
-- (Aplicada en partes 011a–011d.)

-- 1) Bug: register_restock manda source='otro' pero el CHECK no lo permitía.
alter table public.restocks drop constraint restocks_source_check;
alter table public.restocks add constraint restocks_source_check
  check (source = any (array['proveedor','otro','devolucion','ajuste']));

-- 2) Validaciones simples (verificado: ninguna fila actual las viola)
alter table public.restocks add constraint restocks_cost_nonneg check (cost is null or cost >= 0);
alter table public.events add constraint events_dates_ok check (end_date is null or start_date is null or end_date >= start_date);
alter table public.event_items add constraint event_items_returned_le_allocated check (qty_returned <= qty_allocated);

-- 3) Índices en claves foráneas
create index if not exists event_items_event_id_idx on public.event_items(event_id);
create index if not exists event_items_item_id_idx on public.event_items(item_id);
create index if not exists movements_created_by_idx on public.movements(created_by);
create index if not exists movements_item_id_idx on public.movements(item_id);
create index if not exists profiles_destination_id_idx on public.profiles(destination_id);
create index if not exists restocks_item_id_idx on public.restocks(item_id);
create index if not exists shipments_origin_id_idx on public.shipments(origin_id);
create index if not exists withdrawals_item_id_idx on public.withdrawals(item_id);

-- 4) RLS: initplan en profiles
alter policy profiles_select on public.profiles using (id = (select auth.uid()) or public.is_staff());

-- 5) Cuentas nuevas: sin acceso hasta que un admin les asigne rol
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array['admin','editor','punto','viewer','none']));
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $f$
begin
  insert into public.profiles(id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, 'none')
  on conflict (id) do nothing;
  return new;
end $f$;

-- 6) Funciones internas/legadas que no deben llamarse desde la API
revoke execute on function public.log_initial_stock() from public, anon, authenticated;
revoke execute on function public.register_movement(uuid, text, integer, date, text) from public, anon, authenticated;
revoke execute on function public.register_movement(uuid, text, integer, date, text, text, text, text, text, text, text) from public, anon, authenticated;

-- PENDIENTE (lo bloquea la capa de permisos de la herramienta, se hace desde el SQL Editor):
--  * guard_item_stock: impedir archivar (active=false) por update directo; delete_item debería hacer
--    set_config('app.stock_rpc','on',true) antes de archivar.
--  * destinations: separar destinations_write (ALL) en insert/update/delete para evitar políticas permisivas múltiples.
