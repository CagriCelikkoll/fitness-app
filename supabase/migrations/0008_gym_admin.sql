-- =====================================================================
-- Dinç — v3.2d yönetici: salon ayarları ve katılım kodu
--
-- Supabase SQL Editor'de 0001–0007'den SONRA, baştan sona tek seferde
-- çalıştırılır.
--
-- Üye yönetimi (rol, üyelik bitişi, çıkarma) için 0001'in kuralları
-- yeterli, değişmedi: yalnızca yönetici değiştirir, kendi rolünü
-- düşüremez (salonda hep bir yönetici kalır), hoca ve yönetici listeyi
-- okur, üye yalnızca kendi satırını görür.
--
-- Bu dosya:
-- - Salon adı ve rengini yalnızca yönetici değiştirir (ad 2–40, renk
--   #RRGGBB). Kod, logo ve kimlik istemciden değişmez.
-- - Katılım kodu artık yalnızca yöneticiye görünür (gym_join_code).
--   Önceden salonun her üyesi okuyabiliyordu; kod yenilemenin anlamı
--   olsun diye kapatıldı.
-- - Yeni kod: regenerate_join_code (yalnızca yönetici, güvenli rastgele,
--   çakışma denetimli). Eski kod hemen geçersiz; mevcut üyeler etkilenmez.
--
-- test/integration/gymAdmin.int.ts gerçek test projesinde deniyor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Kısıtlar (mevcut satırlar denetlenmez: not valid; yeni yazımlar denetlenir)
-- ---------------------------------------------------------------------

alter table public.gyms
  add constraint gyms_name_check check (
    char_length(name) between 2 and 40
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ) not valid;

alter table public.gyms
  add constraint gyms_primary_color_check check (
    primary_color is null or primary_color ~ '^#[0-9A-F]{6}$'
  ) not valid;

-- ---------------------------------------------------------------------
-- Yetkiler: kod sütunu okunmaz; ad ve renk yalnızca yönetici yazar
-- ---------------------------------------------------------------------

revoke select on table public.gyms from authenticated;
grant select (id, name, primary_color, logo_url, created_at) on table public.gyms to authenticated;
grant update (name, primary_color) on table public.gyms to authenticated;

create policy gyms_update_admin on public.gyms
  for update to authenticated
  using (public.is_gym_admin(id))
  with check (public.is_gym_admin(id));

-- ---------------------------------------------------------------------
-- Katılım kodu: okuma ve yenileme (yalnızca yönetici)
-- ---------------------------------------------------------------------

create function public.gym_join_code(p_gym_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_gym_admin(p_gym_id) then
    raise exception 'permission denied for gym join code' using errcode = '42501';
  end if;
  return (select g.join_code from public.gyms g where g.id = p_gym_id);
end;
$$;

-- 6 karakter, 32'lik alfabe (I, O, 0, 1 yok: karışmasın). Rastgelelik
-- gen_random_uuid'den (çekirdek, güvenli üreteç; eklenti gerekmez);
-- 9–14. baytlar tamamen rastgele, 256 % 32 = 0 olduğu için sapma yok.
create function public.regenerate_join_code(p_gym_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  v_attempt integer := 0;
begin
  if not public.is_gym_admin(p_gym_id) then
    raise exception 'permission denied for gym join code' using errcode = '42501';
  end if;
  loop
    v_attempt := v_attempt + 1;
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 9..14 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.gyms g where g.join_code = v_code);
    if v_attempt >= 20 then
      raise exception 'join_code_generation_failed' using errcode = 'P0001';
    end if;
  end loop;

  update public.gyms set join_code = v_code where id = p_gym_id;
  return v_code;
end;
$$;

revoke execute on function
  public.gym_join_code(uuid),
  public.regenerate_join_code(uuid)
  from public, anon;
grant execute on function
  public.gym_join_code(uuid),
  public.regenerate_join_code(uuid)
  to authenticated;
