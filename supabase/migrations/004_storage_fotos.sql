-- Permite que admin y editores suban fotos desde la plataforma (bucket "item-photos")
insert into storage.buckets(id, name, public) values ('item-photos','item-photos', true) on conflict (id) do nothing;
drop policy if exists item_photos_insert on storage.objects;
create policy item_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos' and public.app_role() in ('admin','editor'));
drop policy if exists item_photos_update on storage.objects;
create policy item_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'item-photos' and public.app_role() in ('admin','editor'));
