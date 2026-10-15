-- 005 · Cambios de la auditoría (ya aplicados en la base real)
-- 1) Funciones viejas sin uso: ya nadie puede ejecutarlas (había un hueco de doble conteo de stock)
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.guard_item_stock() from public, anon, authenticated;
revoke execute on function public.register_movement(uuid, text, integer, date, text) from public, anon, authenticated;
revoke execute on function public.register_movement(uuid, text, integer, date, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.confirm_reception(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.send_to_destination(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.open_event(text, date, text, text, text) from public, anon, authenticated;
revoke execute on function public.add_item_to_event(uuid, uuid, integer, timestamp with time zone, text) from public, anon, authenticated;
-- 2) Solo el admin puede crear/editar/borrar depósitos y concesionarios
alter policy destinations_write on public.destinations using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
-- 3) Nombre del depósito central en el historial
update public.movements set origen = 'DEPOSITO MARKETING ROSARIO' where origen = 'Depo Central';
-- 4) Fechas con hora de Argentina
alter database postgres set timezone to 'America/Argentina/Buenos_Aires';
-- 5) receive_shipment: ignora líneas ya recibidas (ver 002 + este cambio, ya aplicado)
