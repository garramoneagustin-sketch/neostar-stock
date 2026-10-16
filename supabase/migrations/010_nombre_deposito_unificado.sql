-- Unifica el nombre "Depo Central" -> "DEPOSITO MARKETING ROSARIO" en mensajes y filas nuevas.
-- (Verificado: ningún dato existente usa "Depo Central".)
do $$
declare r record;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%Depo Central%'
  loop
    execute replace(pg_get_functiondef(r.oid), 'Depo Central', 'DEPOSITO MARKETING ROSARIO');
  end loop;
end $$;
