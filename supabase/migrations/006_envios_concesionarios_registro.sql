-- 006 · Envíos: Santa Fe y Cañada controlan la recepción; el resto de los concesionarios es solo registro.
-- (ya aplicado en la base real)
update public.destinations set is_depot = true where id = '62c4aa47-1818-40e0-bc77-351d96793101'; -- Cañada de Gómez
-- create_shipment: si el destino NO tiene is_depot, el envío queda registrado como recibido (descuenta del central y
-- suma a lo enviado al concesionario). Si tiene is_depot, queda «en camino» hasta que lo reciban con ✓/✗.
-- Ver la función completa en la base (create or replace public.create_shipment).
