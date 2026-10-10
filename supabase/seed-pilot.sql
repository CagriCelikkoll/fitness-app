-- =====================================================================
-- Dinç — pilot salonu ve ilk yönetici (ŞABLON)
--
-- Uygulamada salon oluşturma yok; salon ve ilk yönetici buradan, elle
-- eklenir. Supabase SQL Editor'de çalıştır (orada RLS atlanır).
--
-- Sıra:
--   1. Önce 0001_init.sql çalışmış olsun.
--   2. Yönetici olacak kişi uygulamadan bir kez giriş yapsın
--      (Ayarlar → Hesap ve salon → e-posta + kod). Bu, auth.users'ta
--      ve profiles'ta satırını oluşturur.
--   3. Aşağıdaki yer tutucuları doldur:
--        <SALON ADI>          ör. Örnek Spor Salonu
--        <KATILMA KODU>       6–8 karakter, yalnızca A–Z ve 0–9, BÜYÜK harf
--                             (ör. ORNEK24). O ve 0, I ve 1 gibi
--                             karışan karakterlerden kaçın.
--        <YÖNETİCİ E-POSTASI> yöneticinin giriş yaptığı e-posta
--   4. Tamamını çalıştır. Sonda yönetici satırı listelenmeli.
--
-- Üyeler uygulamada Ayarlar → Hesap ve salon → "Salona katıl" ile bu
-- kodu girerek katılır. Hoca yapmak için yönetici uygulamadan rol
-- değiştirebilir (sonraki tur) ya da buradaki son sorgu kullanılır.
-- =====================================================================

with new_gym as (
  insert into public.gyms (name, join_code)
  values ('<SALON ADI>', '<KATILMA KODU>')
  returning id
)
insert into public.gym_members (gym_id, user_id, role)
select new_gym.id, u.id, 'admin'
from new_gym
join auth.users u on lower(u.email) = lower('<YÖNETİCİ E-POSTASI>');

-- Kontrol: salon ve yöneticisi
select g.name, g.join_code, u.email, m.role
from public.gyms g
join public.gym_members m on m.gym_id = g.id
join auth.users u on u.id = m.user_id
where g.join_code = '<KATILMA KODU>';

-- Not: e-posta yanlışsa salon eklenir ama yönetici eklenmez (kontrol
-- sorgusu boş döner). O durumda yöneticiyi sonradan ekle:
--
-- insert into public.gym_members (gym_id, user_id, role)
-- select g.id, u.id, 'admin'
-- from public.gyms g, auth.users u
-- where g.join_code = '<KATILMA KODU>'
--   and lower(u.email) = lower('<YÖNETİCİ E-POSTASI>');
--
-- Bir üyeyi hoca yapmak:
--
-- update public.gym_members m set role = 'trainer'
-- from public.gyms g, auth.users u
-- where m.gym_id = g.id and m.user_id = u.id
--   and g.join_code = '<KATILMA KODU>'
--   and lower(u.email) = lower('<HOCA E-POSTASI>');
