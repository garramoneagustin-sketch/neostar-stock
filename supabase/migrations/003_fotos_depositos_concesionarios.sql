-- =====================================================================
-- 003 · Fotos por material, nombres de depósitos y envíos a concesionarios
-- Solo agrega cosas. No borra datos.
-- =====================================================================

-- 1) Fotos (varias por material). Enlaces de Drive o archivos subidos al Storage.
alter table public.items add column if not exists photo_urls text[] not null default '{}';

-- 2) Qué destinos son depósitos (con control de recepción) y cuáles son concesionarios (solo seguimiento)
alter table public.destinations add column if not exists is_depot boolean not null default false;
update public.destinations set is_depot = true, name = 'DEPOSITO MARKETING SANTA FE'
 where id = 'b64042df-fb2e-47df-9242-771901c2debb';

-- 3) Envíos: a un concesionario se registran directo (descuenta del central y suma a lo que tiene);
--    a un depósito siguen "en camino" hasta que lo reciban y controlen.
create or replace function public.create_shipment(p_destination_id uuid, p_items jsonb,
  p_recipient_name text default null, p_notes text default null)
returns public.shipments language plpgsql security definer set search_path = public as $$
declare s public.shipments; d public.destinations; l record; direct boolean;
begin
  perform public._require_staff();
  select * into d from public.destinations where id = p_destination_id;
  if not found then raise exception 'Destino inexistente'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un material al envío';
  end if;
  direct := not d.is_depot;
  perform set_config('app.stock_rpc','on',true);
  insert into public.shipments(destination_id, destination_name, recipient_name, notes, created_by, created_by_name,
                               status, received_by, received_by_name, received_at, reviewed)
  values (p_destination_id, d.name, nullif(trim(p_recipient_name),''), nullif(trim(p_notes),''), auth.uid(), public.app_person(),
          case when direct then 'recibido' else 'en_transito' end,
          case when direct then auth.uid() end, case when direct then public.app_person() end,
          case when direct then now() end, direct)
  returning * into s;
  for l in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::integer) as qty
      from jsonb_array_elements(p_items) e group by 1
  loop
    if l.qty is null or l.qty <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
    update public.items set stock_nucleo = stock_nucleo - l.qty
     where id = l.item_id and active and stock_nucleo >= l.qty;
    if not found then
      raise exception 'Stock insuficiente en DEPOSITO MARKETING ROSARIO para "%"', coalesce((select name from public.items where id = l.item_id), 'material inexistente');
    end if;
    insert into public.movements(item_id, type, qty, fecha, origen, destino_id, destination, estado,
                                 recipient_name, person, created_by, notes, shipment_id, qty_received, reception_ok)
    values (l.item_id, 'envio_destino', l.qty, current_date, 'DEPOSITO MARKETING ROSARIO', p_destination_id, d.name,
            case when direct then 'recibido' else 'en_transito' end,
            nullif(trim(p_recipient_name),''), public.app_person(), auth.uid(), nullif(trim(p_notes),''), s.id,
            case when direct then l.qty end, case when direct then true end);
    if direct then
      insert into public.destination_stock(destination_id, item_id, qty) values (p_destination_id, l.item_id, l.qty)
      on conflict (destination_id, item_id) do update set qty = public.destination_stock.qty + excluded.qty, updated_at = now();
    end if;
  end loop;
  return s;
end; $$;

-- 4) Fotos subidas desde la app (bucket público de lectura; suben solo admin/editor)
insert into storage.buckets(id, name, public) values ('item-photos','item-photos', true) on conflict (id) do nothing;
drop policy if exists item_photos_insert on storage.objects;
create policy item_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos' and public.app_role() in ('admin','editor'));
drop policy if exists item_photos_update on storage.objects;
create policy item_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'item-photos' and public.app_role() in ('admin','editor'));

-- 5) Fotos del Excel (enlaces de Drive) cargadas en los materiales
update public.items i set photo_urls=v.u from (values
('Auriculares','Nissan',array['https://drive.google.com/file/d/1WbOfH8Gn-cu2EtVm7Up3ZVVAiH5MrcRO/view']),
('Bandera','Jeep',array['https://drive.google.com/file/d/1GoJ2CruVL-5Go__AY9Z1DUIuzBvVZsLH/view']),
('Barbijos','Genérico',array['https://drive.google.com/file/d/1z3PGqAaorWdBO52EmcgFdUOd7InNAuPK/view']),
('Base cruz flight banner','Genérico',array['https://drive.google.com/file/d/1nwE0HdYRpZ1ymr6jGOSOv16XCOTDg0EY/view']),
('Bolsa blanca de tela para mate institucional','Genérico',array['https://drive.google.com/file/d/17OYjb5OXt0iuOkRzoxeZH8gD9g573TYn/view']),
('Bolsa ecológica de tela','Genérico',array['https://drive.google.com/file/d/17qRZqqEmEVTNWsCbyE_G-sKb2VL9Y4Ad/view']),
('Bolsa friselina entrega 0KM 2026','Genérico',array['https://drive.google.com/file/d/1Pj-JhaXP27Ug-d3bjPDUe8J5tO1EQGS6/view']),
('Bolsa friselina vertical','Genérico',array['https://drive.google.com/file/d/1Gn10ITmq3Oa5RkdbMzvxzSdc328EiGsP/view']),
('Bolsa papel madera','RAM',array['https://drive.google.com/file/d/1a-49jkVqmAwqNZilx6zQvTVrPel3wA0B/view']),
('Bolsa papel madera','Genérico',array['https://drive.google.com/file/d/1REeafRmTe9r7AlNvUGVn6UtAkir0zjua/view']),
('Bolsas para regalo 0KM','Genérico',array['https://drive.google.com/file/d/1cA-1NZ-aH9-gU987IrN9tQxxpKeoS2uN/view']),
('Bombilla para mate institucional','Genérico',array['https://drive.google.com/file/d/1sz5Z8UeF43u53aJUXpL5WoetPpyU2rPJ/view']),
('Botella térmica','Nissan',array['https://drive.google.com/file/d/1u4EYq-4v10DOLUcYQh4gzYCqrV-hoPbL/view']),
('Botella térmica 500ml','Jeep',array['https://drive.google.com/file/d/1PUaTH3bE0Jk5NQW2lFO5SvOars4k7CUh/view']),
('Botella transparente','Genérico',array['https://drive.google.com/file/d/1ttmdO2qdFCnISV2yT9adUcENd0DtvPwu/view']),
('Cable VTOL','BYD',array['https://drive.google.com/file/d/1odcy_jOJVVM4zvjnc92gBkCrdnoOlnq1/view']),
('Cajón con tapa','Genérico',array['https://drive.google.com/file/d/1efPypeUh4ihIKmiu18rQyY0HkubN6Ies/view']),
('Calcomanía para 0KM','Genérico',array['https://drive.google.com/file/d/1_t1dgZx-yOcLT-UrX3oMywCV7s3kqFV6/view']),
('Calcomanía varios modelos','RAM',array['https://drive.google.com/file/d/1mlGcT5I96C-vbFGYBhitQ9bo-MTTLZw1/view']),
('Carpa Neostar','Genérico',array['https://drive.google.com/file/d/1HxRzqENVgVUnpRSE8UPE4WDGWFGzdvIv/view']),
('Carpetas Institucionales','Genérico',array['https://drive.google.com/file/d/1nAxZF8e5grl7p2ptDSmFxlhpOV_gEWNx/view']),
('Carpetas Plan de ahorro','Genérico',array['https://drive.google.com/file/d/1CgVy-1yM5xUfuj131BPj6ENnFXnGrUnu/view']),
('Cuaderno con ojalillos','Jeep',array['https://drive.google.com/file/d/19wwmukYjS-RnTZxgsPYO_oIMTpN7fPKY/view']),
('Daruma','Nissan',array['https://drive.google.com/file/d/170vQBARZNylJNsLWVU5dI4dCDb8Jmcg0/view']),
('Estaca en forma de U','Genérico',array['https://drive.google.com/file/d/1ylxHYzyFAFTwCesUqVvsBJ9fr4xlwGBs/view']),
('Estaca fina','Genérico',array['https://drive.google.com/file/d/16Ozem1W0fa4KdXh28qMNDIQtuhnDqcGy/view']),
('Estaca flight banner','Genérico',array['https://drive.google.com/file/d/1hQ5laiR0rq8k75Bo7IUSyGX3h05w0tBd/view']),
('Estaca metálica con pisador','Genérico',array['https://drive.google.com/file/d/1hxHtozhsTBvSX0rPobtv534vGpVycdg8/view']),
('Estacas carpa','Genérico',array['https://drive.google.com/file/d/1hbiLothAzBMr8srLiT4K4VZb7y1mrg75/view']),
('Estacas con tope superior','Genérico',array['https://drive.google.com/file/d/1EABxCbpla-4U5GNd81jXpghc7224WhJy/view']),
('Estacas Gazebo','Genérico',array['https://drive.google.com/file/d/1JjF4UT_BvGLDOlNYtMRngjGEJfQj0Ac9/view']),
('Estacas pequeñas','Genérico',array['https://drive.google.com/file/d/1ak-x00UvUGywcAO4d38oExn6Ynj_0f8y/view']),
('Flag banner','Genérico',array['https://drive.google.com/file/d/1Qp-dXh2GNk6tZF0aOpWaD5Q1Rf95fUcJ/view','https://drive.google.com/file/d/1g-kka9vvv2bn_pPD8AOeR_pDA2XUKPKI/view','https://drive.google.com/file/d/1dOsjE3PA0_LZoSb4d-_SpHzhPwQTBKDF/view']),
('Flag banner','Jeep',array['https://drive.google.com/file/d/1PnEST5SOn6SYyqwowDaqru_RQbPn6VFW/view']),
('Flag banner','RAM',array['https://drive.google.com/file/d/1OpQlUFkU79tF5Vdo_2UdGSO7ZUnRGLjP/view']),
('Flag banner','Suzuki',array['https://drive.google.com/file/d/1UDDyOvdrkf6Jzq0cP4Or2ClrVBxoCgNe/view']),
('Flag banner','Kia',array['https://drive.google.com/file/d/14vj4hnXjjadIl4808LD3iuUVUQgBFUkM/view']),
('Flag banner','Subaru',array['https://drive.google.com/file/d/1GbgHjYgYcDXQd8_iJjg_AUQZPRRY6Wpt/view']),
('Flag banner','Nissan',array['https://drive.google.com/file/d/1bqeTGbDlG1hup1ccc-MT_kGg-A1iqhca/view','https://drive.google.com/file/d/1LPoBOPMQUCFqL8DJUOidIJUg1lt-SdIm/view']),
('Flag banner','BYD',array['https://drive.google.com/file/d/1y5M2Rf5yE_EoKJ2ME4YmDIwLQfd6qxiU/view']),
('Fondo Grupo Vaza','Genérico',array['https://drive.google.com/file/d/1nirWU-LI_9Bn7Ok_oYrKxgh2o0BmTEYS/view']),
('Gazebo','Nissan',array['https://drive.google.com/file/d/1ZGvRe8hGt_sA1cRcs3dSLdIM8Qv6_81K/view','https://drive.google.com/file/d/1TNA2r_FgJXZ0fhAV2Lq_p06yK970KpIy/view']),
('Gazebo','Jeep',array['https://drive.google.com/file/d/1FeCY2PDYups4M5nvZR3lQCKCqDp40lH2/view']),
('Gorra','BYD',array['https://drive.google.com/file/d/1z4NbJi8wcfN7_zenE55jqZo_6DO50MZ4/view']),
('Gorra','RAM',array['https://drive.google.com/file/d/1XECCqq9fcp8Hn8REiLECqGgd-07bNHaa/view']),
('Gorra','Honda',array['https://drive.google.com/file/d/1dZXUiAXPA_IA5Qnasw0PCW4CNISVq5Qv/view']),
('Gorra','Genérico',array['https://drive.google.com/file/d/1l35Y1EHcHJMXX7hpSCH8_4cTqyLjbGbo/view']),
('Gorra','Kia',array['https://drive.google.com/file/d/1RcM1AJfGt5uMY0x1wFmSyDlJg7iHlSVx/view']),
('Gorra','Nissan',array['https://drive.google.com/file/d/1KNU_10oRmNWMxj--gmH6DrybbGPm_6n2/view','https://drive.google.com/file/d/1pUYE3_-7I0akQgacz6DJoMFB36bpM_ZK/view']),
('Gorra','Suzuki',array['https://drive.google.com/file/d/19ecPDTjPw9T7YYoLqA-JrpSV9vCBYhs0/view']),
('Gorra','Subaru',array['https://drive.google.com/file/d/1Hq0njOVKggL8DkHJGc2YijBMPoo7APvD/view']),
('Gorra blanca','Jeep',array['https://drive.google.com/file/d/1bAFWOod9u0HSah83Lrlo9eHzMeZVc4dj/view']),
('Gorra negra','Jeep',array['https://drive.google.com/file/d/1NgwJ6RgfRAj4Sgx17AMje3gHBWAwVuwf/view']),
('Gorra verde','Jeep',array['https://drive.google.com/file/d/1geMsfze0SL1HOSZqVV0JaMHwk_cVOzVT/view']),
('Heladera exhibidora vertical','Genérico',array['https://drive.google.com/file/d/1qAfrBc1Ru6b29oeY_bP9uWcfkj5YskLk/view']),
('Jarro acero nordico','Genérico',array['https://drive.google.com/file/d/1Q5ll05b0VJLfntHTCTmC9h_gQ82yLqG7/view']),
('Jarro termico','Genérico',array['https://drive.google.com/file/d/1HeMCje_6KmPn9e3GQYDOvO9qsYOH59aM/view']),
('Lapicera','Jeep',array['https://drive.google.com/file/d/1K7VMZ9P5wxElxXU5FiksfdS2gUNFd4kI/view']),
('Lapicera blanca','Genérico',array['https://drive.google.com/file/d/1WLDt9kL-xzIg4ommUqlv-FCqtkNpWtYi/view']),
('Lapicera Negra','Genérico',array['https://drive.google.com/file/d/1XC1bschQp4--8RqoBnoYkW2oAykflI62/view']),
('Lapicera Roja/Blanca','Nissan',array['https://drive.google.com/file/d/1cshEZhnqr5skUzxoHSkkf0YK3NDvvKw_/view']),
('Led en caja (nuevo)','Genérico',array['https://drive.google.com/file/d/1wqG1G2wDIi_NO66zb1OidtH3WilJmszy/view']),
('Llaveros corto entrega vehículo','Genérico',array['https://drive.google.com/file/d/1u7PSLrKOboI7kx6_ke4ozqCjkhMaLITY/view']),
('Llaveros metalicos pintados','RAM',array['https://drive.google.com/file/d/1zXP4vpd5h40Fnvs9Zcy0w61715svWY1R/view']),
('Llaveros metalicos pintados','Jeep',array['https://drive.google.com/file/d/1wnVlTkJ_rc3QLl1Eaeif_pr35zC0wTF3/view']),
('Llaveros metalicos pintados','Genérico',array['https://drive.google.com/file/d/1cwcIUD2MJkuOBzJg5i20mLZdtIXb4ifR/view']),
('Llaveros metalicos pintados','BYD',array['https://drive.google.com/file/d/1cfSfVjvzbyfvPhYDIsxDIrxVN1PZHEBR/view']),
('Llaveros metalicos pintados','Subaru',array['https://drive.google.com/file/d/1i68fwNrgGAqA_g99Qy0e3wfBcSZKHFji/view']),
('Llaveros metalicos pintados','Kia',array['https://drive.google.com/file/d/1jWXxLieLDjSLNJD6Li12OHi21qHJlaJb/view']),
('Llaveros metalicos pintados','Suzuki',array['https://drive.google.com/file/d/1dnbGLPQ0GgFZ9avEGNMS7EXq5poiHYWe/view']),
('Llaveros metalicos pintados','Honda',array['https://drive.google.com/file/d/1aDE_TRqkE26zEgZiWzhfUMICvmU_2_kl/view']),
('Lona celeste y blanca','Genérico',array['https://drive.google.com/file/d/1mFkSrJB_AvIe4T0HeqbSX6MMl5JsW093/view']),
('Martillo bolita','BYD',array['https://drive.google.com/file/d/1kttVXC6sHBdPgUE_vAsGhwPR3DAmrrFB/view']),
('Mate + Set yerbero','Genérico',array['https://drive.google.com/file/d/1tUviaIe3_DUYhxm9dN5ElpnbttzwHMfM/view']),
('Mate institucional','Genérico',array['https://drive.google.com/file/d/1qoMRSumoteWlQ0zUmaxLL6jlzltqXkiL/view']),
('Mates pequeños Plan de Ahorro','Genérico',array['https://drive.google.com/file/d/1VW4Nj84iJMnm8oBuwnzQgji-VXjERu7v/view']),
('Mesa eventos plegable','Genérico',array['https://drive.google.com/file/d/1_KqJW5KL9bHijyVxBP-DLOBAjoCxPIyO/view']),
('Motor de carpa','Genérico',array['https://drive.google.com/file/d/14SRuUNOkcDN1cu9WhwgxA5cil5hjiJvM/view']),
('Organizador de viaje','Nissan',array['https://drive.google.com/file/d/1OhQOi9GpVKFfAGavvyVgdU3S-wfe-Iu6/view']),
('Patente','Nissan',array['https://drive.google.com/file/d/1Eq0V5Cz3fbl9DU-o-ljFOULfQMim50XO/view','https://drive.google.com/file/d/1SXHcrTLbm4R5zjz-fmqWaj55iK1-LqGj/view']),
('Patente','Genérico',array['https://drive.google.com/file/d/17DYtv4ttzdRqgSAGCEchsfuwE9gMdPRZ/view']),
('Pie de arena de flight banner','Genérico',array['https://drive.google.com/file/d/1eUqROQ5DnvcqvpBs2nN8XrNyTONb38Fu/view']),
('Portadocumento','Genérico',array['https://drive.google.com/file/d/1B97NA0bijTIklk098U4Lc-GUuTGohx-R/view']),
('Portapatente','Neostar',array['https://drive.google.com/file/d/1m2O0IPN0V75ANRrTkK-yd0sF4SZZfarz/view']),
('Portapatente','RAM',array['https://drive.google.com/file/d/19RESErqIyPa2j_ACkmiu_JnQ3pEuqhVW/view']),
('Portapatente','Jeep',array['https://drive.google.com/file/d/1SsfO_lMNQrqrFUPcvWEMxk96oYEhfsdL/view']),
('Precintos','Genérico',array['https://drive.google.com/file/d/16njWawj3SsWieo___6JUBjlLp9E2Bzvc/view']),
('Proyector de led en uso','Genérico',array['https://drive.google.com/file/d/1socjHcJOQ4TJFiMCeCH9hpq2QgOeC-xt/view']),
('Remera Blanca','RAM',array['https://drive.google.com/file/d/1WTUQV0cqF5274I4FLMl4Yuv2-CUU-kBw/view']),
('Remera Blanca','Jeep',array['https://drive.google.com/file/d/1LMSbsR0tfxF2U9DC5ybm8p8ObIHyKxZq/view']),
('Remera negra','Jeep',array['https://drive.google.com/file/d/1rwdszRUGKzkrxDdt9EAYHB6xr4R5QTmf/view']),
('Ruleta (Juego)','Genérico',array['https://drive.google.com/file/d/1u_RW9ur5G8p-GNbaOH0_dBnJH6Sghm8i/view']),
('Silla de director plegable','Genérico',array['https://drive.google.com/file/d/1jsX-Ry1MZLOR05O7T75BA6j5SbU-VgsC/view']),
('Silla de director plegable','Jeep',array['https://drive.google.com/file/d/1YwXWIHFexxQgUeA73y2NyoKfDPq84bqF/view']),
('Silla de director plegable','Nissan',array['https://drive.google.com/file/d/1BXHKmxZ5YzYxwfHtnQUfz4hkC_3AntBR/view','https://drive.google.com/file/d/1kDQPIIhV3UnCBT491lpKBcxM8sad9HSZ/view']),
('Silla de director plegable','RAM',array['https://drive.google.com/file/d/1eOU1GPfHjgLMxBjtARqVb-kSCo50GU6F/view']),
('Silla de director plegable','BYD',array['https://drive.google.com/file/d/12OO0hYiiM0C7H32di05ouZja4L50AS3j/view']),
('Soga anaranjada con gancho en S','Genérico',array['https://drive.google.com/file/d/1kePVHetiqMlAn0wVfzK3qsWR6wfa3PHs/view']),
('Soga gruesa','Genérico',array['https://drive.google.com/file/d/1r7kkdlQ9FONDWfTtHAz_1wEvXXtzBII4/view']),
('Sogas fina blanco y negro','Genérico',array['https://drive.google.com/file/d/1asQQGC-xvzkTxYfhmStQxVYrt36jZdVl/view']),
('Sombrilla','Nissan',array['https://drive.google.com/file/d/1SW2ceu8GsK6KFGUOUmWTlufIfO_lO4js/view']),
('Sombrilla','Jeep',array['https://drive.google.com/file/d/1kEwas6gCCjaziBIOEYDL8mLu8hlMdliP/view']),
('Sombrilla','Genérico',array['https://drive.google.com/file/d/1qGoWGcHp-Lg5Kzm_yKRDlzru29zb7ugo/view']),
('Sombrilla + Base','BYD',array['https://drive.google.com/file/d/1Be1BQCUV62N9SW3R84HBLrLWbWoWY2Fs/view']),
('Termo Basecamp','Genérico',array['https://drive.google.com/file/d/1oO03aOd3jDGsrdFhHE7i-6k-OB0Ff6OD/view']),
('Tira larga','RAM',array['https://drive.google.com/file/d/1EodlYG4NyR6yFKpppRa-ujAKN5vB9vLg/view']),
('Tira larga','Jeep',array['https://drive.google.com/file/d/1ylt43wZ3FaAqXCxv6sIXlD4LB6LYynp6/view']),
('Toalla microfibra','Genérico',array['https://drive.google.com/file/d/1NdjK4uf7e4NyQSB899xPHvH92aYDTB2P/view']),
('Vaso eventos color blanco','Genérico',array['https://drive.google.com/file/d/1M6mJMypC_BsRMZMRm0lqoe1yRhv9kOkD/view']),
('Vaso pequeño cafe con franja blanca','Genérico',array['https://drive.google.com/file/d/1Wf8onPHJfvTLDDFHIBIvVmfR41PKHJFL/view']),
('Vaso pequeño cafe con franja roja','Genérico',array['https://drive.google.com/file/d/1filDF0i2rrGLB8SGqzEn2DSlNhNTFbPm/view']),
('Vaso térmico con tapa','Genérico',array['https://drive.google.com/file/d/1zZ5mrRAIeL2onn543W2ziNyVqOgwpCJD/view']),
('Vaso térmico desactualizado','Genérico',array['https://drive.google.com/file/d/1iUjrBPeEWscYdoOyIqwuIMdUknw3gAqe/view']),
('Vasos térmicos 0KM','BYD',array['https://drive.google.com/file/d/1QM6D4WwSa57ZO_GDgCtgC-66peiCcICg/view']),
('Vasos térmicos 0KM','Genérico',array['https://drive.google.com/file/d/1r7y6C590EWmcCsEHqJ0AUplaoWcVm4S2/view']),
('Vasos térmicos 0KM (backup)','Genérico',array['https://drive.google.com/file/d/1QFieSHPQID8zg0jDUL40J5kxRtmnNGKJ/view']),
('Zapatillas','Genérico',array['https://drive.google.com/file/d/13BraW2CxA3d3C_aBKy9zzUzV_KAi-8te/view']),
('Cinta Neostar largas','Genérico',array['https://drive.google.com/file/d/1MukU_HJZ4RY_8Ar_KGZC1PDJ6ZwbNWxe/view'])
) as v(n,b,u) where i.name=v.n and i.brand=v.b;
