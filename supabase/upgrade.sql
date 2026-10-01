-- Neostar Stock: ampliación de clasificación, retiros y auditoría.
-- Ejecutar en Supabase SQL Editor DESPUÉS del schema.sql original.
alter table public.items add column if not exists sku text;
alter table public.items add column if not exists subcategory text;
alter table public.items add column if not exists occasion text;
alter table public.items add column if not exists scope text default 'generico';
alter table public.items add column if not exists brand text;
alter table public.items add column if not exists stock_nucleo integer default 0;
alter table public.items add column if not exists stock_sf integer default 0;
alter table public.items add column if not exists reorder_nucleo integer default 0;
alter table public.items add column if not exists reorder_sf integer default 0;
alter table public.items add column if not exists lead_time_days integer default 0;
alter table public.items add column if not exists total_qty integer default 0;
create unique index if not exists items_sku_unique on public.items(sku) where sku is not null and sku <> '';
alter table public.movements add column if not exists reason_type text default 'operativo';
alter table public.movements add column if not exists reason_detail text;
alter table public.movements add column if not exists recipient_last_name text;
alter table public.movements add column if not exists origin text;
alter table public.movements add column if not exists destination text;
alter table public.movements add column if not exists notes text;
-- La función admite el retiro contextual y conserva compatibilidad con el formulario anterior.
create or replace function public.register_movement(p_item_id uuid,p_type text,p_qty integer,p_fecha date,p_person text default null,p_reason_type text default 'operativo',p_reason_detail text default null,p_recipient_last_name text default null,p_origin text default null,p_destination text default null) returns public.movements language plpgsql security invoker as $$
declare r public.movements;
begin
 if p_qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
 insert into public.movements(item_id,type,qty,fecha,person,reason_type,reason_detail,recipient_last_name,origin,destination) values(p_item_id,p_type,p_qty,p_fecha,p_person,p_reason_type,p_reason_detail,p_recipient_last_name,p_origin,p_destination) returning * into r;
 return r;
end; $$;
-- Validación de apellido para incidencias de clientes.
create or replace function public.validate_customer_reason() returns trigger language plpgsql as $$ begin if new.reason_type='incidencia_cliente' and coalesce(trim(new.recipient_last_name),'')='' then raise exception 'El apellido del cliente es obligatorio para una incidencia'; end if; return new; end; $$;
drop trigger if exists movements_customer_reason on public.movements;
create trigger movements_customer_reason before insert or update on public.movements for each row execute function public.validate_customer_reason();
alter table public.movements enable row level security;
