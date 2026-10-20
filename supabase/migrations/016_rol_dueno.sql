-- 016: rol Dueño. Un único usuario con control total sobre usuarios y roles.
-- Es un rol visible: aparece en la pantalla Usuarios. El resto de los administradores NO puede cambiar roles ni depósitos.
-- Para transferir el rol hay que hacerlo desde el SQL Editor de Supabase (auth.uid() es NULL ahí).

alter table public.profiles add column if not exists is_owner boolean not null default false;

-- Un solo Dueño en todo el sistema
create unique index if not exists profiles_single_owner on public.profiles ((true)) where is_owner;

create or replace function public.app_is_owner() returns boolean
language sql stable security definer set search_path to 'public'
as $f$ select coalesce((select is_owner from public.profiles where id = auth.uid()), false) $f$;
revoke all on function public.app_is_owner() from public, anon;
grant execute on function public.app_is_owner() to authenticated;

-- Solo el Dueño cambia roles, depósitos y datos de usuarios
alter policy profiles_admin_update on public.profiles
  using (public.app_is_owner()) with check (public.app_is_owner());

-- El Dueño no se puede asignar ni quitar desde la app y siempre queda como admin.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path to 'public'
as $f$
begin
  if auth.uid() is not null then
    if new.is_owner is distinct from old.is_owner then
      raise exception 'El rol Dueño no se puede asignar ni quitar desde la app';
    end if;
  end if;
  if old.is_owner and new.role <> 'admin' then
    raise exception 'El Dueño siempre tiene rol admin';
  end if;
  if new.role = 'punto' and new.destination_id is null then
    raise exception 'Un usuario de depósito necesita un depósito asignado';
  end if;
  return new;
end $f$;

create trigger profiles_guard before update on public.profiles
for each row execute function public.profiles_guard();

update public.profiles set is_owner = true where email = 'garramoneagustin@gmail.com';
