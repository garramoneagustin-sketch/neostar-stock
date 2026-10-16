-- Destinos reales, nombrados "Marca - Ciudad". Solo renombra/crea; los ids existentes se conservan.
update public.destinations set name='Nissan - Rosario', marcas='{Nissan}' where name='Nissan';
update public.destinations set name='Subaru - Funes',   marcas='{Subaru}' where name='Funes';
update public.destinations set name='Multimarca - Cañada de Gómez', marcas='{Jeep,RAM,Kia,Nissan,Subaru,Suzuki,BYD,Honda}' where name='Cañada de Gómez';
update public.destinations set name='BYD - Santa Fe'   where name='BYD Santa Fe';
update public.destinations set name='Honda - Santa Fe' where name='Honda Santa Fe';

insert into public.destinations (name, abastecido_por, marcas, is_depot, supplies_dealers)
select v.name, v.por, v.marcas, false, false
from (values
  ('BYD - Rosario',    'nucleo',      '{BYD}'::text[]),
  ('Jeep - Rosario',   'nucleo',      '{Jeep}'::text[]),
  ('RAM - Rosario',    'nucleo',      '{RAM}'::text[]),
  ('Suzuki - Funes',   'nucleo',      '{Suzuki}'::text[]),
  ('Kia - Santa Fe',   'deposito_sf', '{Kia}'::text[]),
  ('Subaru - Santa Fe','deposito_sf', '{Subaru}'::text[]),
  ('Suzuki - Santa Fe','deposito_sf', '{Suzuki}'::text[])
) as v(name, por, marcas)
where not exists (select 1 from public.destinations d where d.name = v.name);
