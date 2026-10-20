-- 015: categorías como tabla + coherencia Tipo/Categoría + marca y alcance calculados por la base.
-- Aplicada en partes 015a y 015b (más la normalización de 4 materiales existentes).
-- Decisión D2: «Neostar» se trata como genérico (aparece para todas las marcas y en todos los eventos).

create table if not exists public.categories (
  name   text primary key,
  kind   text not null check (kind in ('consumible','equipamiento')),
  sort   integer not null default 100,
  active boolean not null default true
);
alter table public.categories enable row level security;
create policy categories_select on public.categories for select to authenticated using (public.app_role() <> 'none');
create policy categories_write on public.categories for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

insert into public.categories(name, kind)
select category, mode() within group (order by kind) from public.items group by category
on conflict (name) do nothing;

alter table public.items
  add constraint items_category_fk foreign key (category) references public.categories(name) on update cascade;
create index if not exists items_category_idx on public.items(category);

create or replace function public.items_validate()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare k text;
begin
  select kind into k from public.categories where name = new.category;
  if k is null then raise exception 'Categoría inexistente: %', new.category; end if;
  if k <> new.kind then
    raise exception 'La categoría «%» es de tipo %, pero el material es %', new.category, k, new.kind;
  end if;
  new.brand := coalesce(nullif(trim(new.brand), ''), 'Genérico');
  new.scope := case when new.brand in ('Genérico', 'Neostar') then 'generico' else 'marca' end;
  return new;
end; $function$;

create trigger items_validate before insert or update of category, kind, brand, scope on public.items
for each row execute function public.items_validate();

-- Normaliza el alcance de los materiales existentes que no coincidían con su marca (4 filas)
update public.items set brand = brand
 where (scope = 'marca' and brand in ('Genérico','Neostar')) or (scope = 'generico' and brand not in ('Genérico','Neostar'));
