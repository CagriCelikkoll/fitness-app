/**
 * Supabase satır düzeyinde güvenlik (v3.0) — gerçek Postgres'e karşı.
 *
 * `supabase/migrations/0001_init.sql` PGlite'ta (Postgres'in WASM hali)
 * çalıştırılıyor. Supabase'in sağladığı parçalar (anon / authenticated
 * rolleri, auth.users, auth.uid()) küçük bir stub ile kuruluyor:
 * auth.uid() `request.jwt.claim.sub` ayarından okuyor, Supabase'deki
 * gibi. Her sorgu `authenticated` rolüne geçip o kullanıcı gibi
 * çalışıyor; süper kullanıcı RLS'yi atladığı için bu şart.
 *
 * RLS hatası = bir üyenin başka salonun verisini görmesi.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite, type Transaction } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../supabase/migrations/0001_init.sql'),
  'utf8'
);

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`;

// Kullanıcılar
const U = {
  adminA: '00000000-0000-0000-0000-00000000000a',
  trainerA: '00000000-0000-0000-0000-00000000000b',
  memberA: '00000000-0000-0000-0000-00000000000c',
  member2A: '00000000-0000-0000-0000-00000000000d',
  adminB: '00000000-0000-0000-0000-0000000000a1',
  memberB: '00000000-0000-0000-0000-0000000000a2',
  outsider: '00000000-0000-0000-0000-0000000000ff',
} as const;

const GYM_A = '10000000-0000-0000-0000-00000000000a';
const GYM_B = '10000000-0000-0000-0000-00000000000b';

let pg: PGlite;
// Temiz başlangıç: migration + tohum sonrası döküm yerine her testte
// veriyi silip yeniden ekliyoruz (PGlite'ı her testte açmak yavaş).
const SEED = `
  insert into auth.users (id, email) values
    ('${U.adminA}', 'admin-a@x'), ('${U.trainerA}', 'trainer-a@x'),
    ('${U.memberA}', 'member-a@x'), ('${U.member2A}', 'member2-a@x'),
    ('${U.adminB}', 'admin-b@x'), ('${U.memberB}', 'member-b@x'),
    ('${U.outsider}', 'outsider@x');
  update public.profiles set display_name = 'P-' || substr(id::text, 25);
  insert into public.gyms (id, name, join_code) values
    ('${GYM_A}', 'Salon A', 'AAA111'),
    ('${GYM_B}', 'Salon B', 'BBB222');
  insert into public.gym_members (gym_id, user_id, role, membership_ends_on) values
    ('${GYM_A}', '${U.adminA}', 'admin', null),
    ('${GYM_A}', '${U.trainerA}', 'trainer', null),
    ('${GYM_A}', '${U.memberA}', 'member', '2027-01-31'),
    ('${GYM_A}', '${U.member2A}', 'member', null),
    ('${GYM_B}', '${U.adminB}', 'admin', null),
    ('${GYM_B}', '${U.memberB}', 'member', null);
`;

/** `fn`'i verilen kullanıcı gibi (authenticated rolüyle) çalıştırır */
async function as<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return pg.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}

async function rows<T = Record<string, unknown>>(
  userId: string,
  query: string,
  params: unknown[] = []
): Promise<T[]> {
  return as(userId, async (tx) => (await tx.query<T>(query, params)).rows);
}

/** Süper kullanıcı olarak (RLS'siz) gerçek durumu oku */
async function adminRows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await pg.query<T>(query, params)).rows;
}

async function roleOf(gymId: string, userId: string) {
  const r = await adminRows<{ role: string }>(
    'select role from public.gym_members where gym_id = $1 and user_id = $2',
    [gymId, userId]
  );
  return r[0]?.role ?? null;
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SUPABASE_STUB);
  await pg.exec(MIGRATION);
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.exec(`
    truncate public.gym_join_attempts, public.gym_members, public.gyms, public.profiles;
    delete from auth.users;
  `);
  await pg.exec(SEED);
});

describe('profiles', () => {
  it('yeni kullanıcı kaydında profil satırı oluşuyor', async () => {
    const r = await adminRows('select id from public.profiles order by id');
    expect(r).toHaveLength(Object.keys(U).length);
  });

  it('kişi kendi profilini okur ve günceller, başkasınınkini güncelleyemez', async () => {
    const own = await rows(U.outsider, 'select id from public.profiles');
    expect(own).toEqual([{ id: U.outsider }]);

    await rows(U.memberA, `update public.profiles set display_name = 'Yeni' where id = $1`, [U.memberA]);
    await rows(U.memberA, `update public.profiles set display_name = 'Hack' where id = $1`, [U.member2A]);
    const names = await adminRows<{ id: string; display_name: string }>(
      'select id, display_name from public.profiles where id in ($1, $2) order by id',
      [U.memberA, U.member2A]
    );
    expect(names.find((n) => n.id === U.memberA)?.display_name).toBe('Yeni');
    expect(names.find((n) => n.id === U.member2A)?.display_name).not.toBe('Hack');
  });

  it('üye aynı salondaki başkasının profilini görmez', async () => {
    const r = await rows<{ id: string }>(U.memberA, 'select id from public.profiles');
    expect(r.map((x) => x.id)).toEqual([U.memberA]);
  });

  it('hoca ve yönetici yalnızca kendi salonunun üyelerinin adını görür', async () => {
    const salonA = [U.adminA, U.trainerA, U.memberA, U.member2A].sort();
    for (const staff of [U.trainerA, U.adminA]) {
      const r = await rows<{ id: string }>(staff, 'select id from public.profiles order by id');
      expect(r.map((x) => x.id)).toEqual(salonA);
    }
  });
});

describe('gyms', () => {
  it('üye kendi salonunu görür, başka salonu görmez', async () => {
    const r = await rows<{ name: string }>(U.memberA, 'select name from public.gyms');
    expect(r).toEqual([{ name: 'Salon A' }]);
  });

  it('salonu olmayan kullanıcı hiçbir salon görmez', async () => {
    expect(await rows(U.outsider, 'select * from public.gyms')).toEqual([]);
  });

  it('uygulamadan salon oluşturulamaz, güncellenemez, silinemez', async () => {
    await expect(
      rows(U.adminA, `insert into public.gyms (name, join_code) values ('X', 'XXX999')`)
    ).rejects.toThrow(/permission denied/);
    await expect(
      rows(U.adminA, `update public.gyms set name = 'X' where id = $1`, [GYM_A])
    ).rejects.toThrow(/permission denied/);
    await expect(
      rows(U.adminA, 'delete from public.gyms where id = $1', [GYM_A])
    ).rejects.toThrow(/permission denied/);
    expect(await adminRows('select name from public.gyms order by name')).toEqual([
      { name: 'Salon A' },
      { name: 'Salon B' },
    ]);
  });
});

describe('gym_members — okuma', () => {
  it('üye yalnızca kendi satırını görür', async () => {
    const r = await rows<{ user_id: string }>(U.memberA, 'select user_id from public.gym_members');
    expect(r.map((x) => x.user_id)).toEqual([U.memberA]);
  });

  it('hoca ve yönetici kendi salonunun tüm satırlarını görür, başka salonu görmez', async () => {
    for (const staff of [U.trainerA, U.adminA]) {
      const r = await rows<{ gym_id: string }>(staff, 'select gym_id from public.gym_members');
      expect(r).toHaveLength(4);
      expect(r.every((x) => x.gym_id === GYM_A)).toBe(true);
    }
  });
});

describe('gym_members — rol ve üyelik', () => {
  const promote = (actor: string, target: string, role = 'admin') =>
    rows(actor, `update public.gym_members set role = $1 where gym_id = $2 and user_id = $3`, [
      role,
      GYM_A,
      target,
    ]);

  it('üye kendi rolünü yükseltemez', async () => {
    await promote(U.memberA, U.memberA);
    expect(await roleOf(GYM_A, U.memberA)).toBe('member');
  });

  it('hoca kendi rolünü ya da başkasınınkini yükseltemez', async () => {
    await promote(U.trainerA, U.trainerA);
    await promote(U.trainerA, U.memberA, 'trainer');
    expect(await roleOf(GYM_A, U.trainerA)).toBe('trainer');
    expect(await roleOf(GYM_A, U.memberA)).toBe('member');
  });

  it('yönetici kendi salonunda rol ve üyelik bitişini günceller', async () => {
    await promote(U.adminA, U.memberA, 'trainer');
    await rows(
      U.adminA,
      `update public.gym_members set membership_ends_on = '2027-06-30' where gym_id = $1 and user_id = $2`,
      [GYM_A, U.member2A]
    );
    expect(await roleOf(GYM_A, U.memberA)).toBe('trainer');
    const r = await adminRows<{ ends: string }>(
      `select membership_ends_on::text as ends from public.gym_members where gym_id = $1 and user_id = $2`,
      [GYM_A, U.member2A]
    );
    expect(r[0]?.ends).toBe('2027-06-30');
  });

  it('yönetici başka salonun üyesine dokunamaz', async () => {
    await rows(U.adminA, `update public.gym_members set role = 'admin' where user_id = $1`, [
      U.memberB,
    ]);
    expect(await roleOf(GYM_B, U.memberB)).toBe('member');
    await rows(U.adminA, 'delete from public.gym_members where user_id = $1', [U.memberB]);
    expect(await roleOf(GYM_B, U.memberB)).toBe('member');
  });

  it('yönetici kendi rolünü düşüremez', async () => {
    await expect(promote(U.adminA, U.adminA, 'member')).rejects.toThrow(/row-level security/);
    expect(await roleOf(GYM_A, U.adminA)).toBe('admin');
  });

  it('rol ve bitiş dışında sütun güncellenemez (gym_id, user_id)', async () => {
    await expect(
      rows(U.adminA, `update public.gym_members set gym_id = $1 where user_id = $2`, [
        GYM_B,
        U.memberA,
      ])
    ).rejects.toThrow(/permission denied/);
  });

  it('doğrudan insert reddediliyor (yönetici dahil)', async () => {
    for (const actor of [U.outsider, U.adminA]) {
      await expect(
        rows(actor, `insert into public.gym_members (gym_id, user_id) values ($1, $2)`, [
          GYM_A,
          U.outsider,
        ])
      ).rejects.toThrow(/permission denied/);
    }
    expect(await roleOf(GYM_A, U.outsider)).toBeNull();
  });
});

describe('gym_members — ayrılma ve çıkarma', () => {
  it('kişi kendi satırını silebilir (salondan ayrılma)', async () => {
    await rows(U.memberA, 'delete from public.gym_members where user_id = $1', [U.memberA]);
    expect(await roleOf(GYM_A, U.memberA)).toBeNull();
  });

  it('üye ve hoca başkasını çıkaramaz', async () => {
    await rows(U.memberA, 'delete from public.gym_members where user_id = $1', [U.member2A]);
    await rows(U.trainerA, 'delete from public.gym_members where user_id = $1', [U.member2A]);
    expect(await roleOf(GYM_A, U.member2A)).toBe('member');
  });

  it('yönetici kendi salonundan üye çıkarabilir', async () => {
    await rows(U.adminA, 'delete from public.gym_members where gym_id = $1 and user_id = $2', [
      GYM_A,
      U.member2A,
    ]);
    expect(await roleOf(GYM_A, U.member2A)).toBeNull();
  });

  it('salonun tek yöneticisi ayrılamaz; ikinci yönetici varsa ayrılabilir', async () => {
    await rows(U.adminA, 'delete from public.gym_members where user_id = $1', [U.adminA]);
    expect(await roleOf(GYM_A, U.adminA)).toBe('admin');

    await pg.query(`update public.gym_members set role = 'admin' where user_id = $1`, [U.trainerA]);
    await rows(U.adminA, 'delete from public.gym_members where user_id = $1', [U.adminA]);
    expect(await roleOf(GYM_A, U.adminA)).toBeNull();
  });
});

describe('join_gym / preview_gym', () => {
  const join = (userId: string, code: string) =>
    rows<{ gym_id: string; gym_name: string; role: string }>(
      userId,
      'select * from public.join_gym($1)',
      [code]
    );
  const preview = (userId: string, code: string) =>
    rows<{ gym_name: string }>(userId, 'select * from public.preview_gym($1)', [code]);

  it('preview yalnızca salon adını döner', async () => {
    expect(await preview(U.outsider, 'aaa111')).toEqual([{ gym_name: 'Salon A' }]);
    expect(await preview(U.outsider, 'YOKKOD')).toEqual([]);
  });

  it('geçerli kodla üye yapar (boşluk ve küçük harf tolere edilir)', async () => {
    expect(await join(U.outsider, '  aaa 111 ')).toEqual([
      { gym_id: GYM_A, gym_name: 'Salon A', role: 'member' },
    ]);
    expect(await roleOf(GYM_A, U.outsider)).toBe('member');
    // artık salonunu görüyor
    expect(await rows(U.outsider, 'select name from public.gyms')).toEqual([{ name: 'Salon A' }]);
  });

  it('ikinci çağrı çoğaltmaz, mevcut rolü döner', async () => {
    await join(U.outsider, 'AAA111');
    await join(U.outsider, 'AAA111');
    const r = await adminRows('select 1 from public.gym_members where user_id = $1', [U.outsider]);
    expect(r).toHaveLength(1);

    // zaten hoca olan biri "member"a düşmüyor
    expect(await join(U.trainerA, 'AAA111')).toEqual([
      { gym_id: GYM_A, gym_name: 'Salon A', role: 'trainer' },
    ]);
  });

  it('geçersiz kod: boş sonuç (istemci invalid_code gösterir), üyelik yok', async () => {
    expect(await join(U.outsider, 'YANLIS1')).toEqual([]);
    expect(await adminRows('select 1 from public.gym_members where user_id = $1', [U.outsider])).toEqual([]);
  });

  it('10 başarısız denemeden sonra 11. deneme reddediliyor (geçerli kod dahil)', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await join(U.outsider, `YANLIS${i}`)).toEqual([]);
    }
    await expect(join(U.outsider, 'YANLIS99')).rejects.toThrow(/too_many_attempts/);
    await expect(join(U.outsider, 'AAA111')).rejects.toThrow(/too_many_attempts/);
    await expect(preview(U.outsider, 'AAA111')).rejects.toThrow(/too_many_attempts/);
    // başka kullanıcı etkilenmiyor
    expect(await preview(U.memberB, 'AAA111')).toEqual([{ gym_name: 'Salon A' }]);
  });

  it('önizleme denemeleri de sınıra sayılıyor', async () => {
    for (let i = 0; i < 10; i++) await preview(U.outsider, `YOK${i}XX`);
    await expect(join(U.outsider, 'AAA111')).rejects.toThrow(/too_many_attempts/);
  });

  it('bir saatten eski denemeler sayılmıyor', async () => {
    await pg.query(
      `insert into public.gym_join_attempts (user_id, attempted_at)
       select $1, now() - interval '2 hours' from generate_series(1, 10)`,
      [U.outsider]
    );
    expect(await join(U.outsider, 'AAA111')).toHaveLength(1);
  });

  it('başarılı katılma deneme sayılmıyor', async () => {
    for (let i = 0; i < 12; i++) await join(U.outsider, 'AAA111');
    const r = await adminRows('select 1 from public.gym_join_attempts');
    expect(r).toEqual([]);
  });

  it('giriş yapmamış (anon) çağıramaz; deneme tablosu istemciye kapalı', async () => {
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query(`select * from public.join_gym('AAA111')`);
      })
    ).rejects.toThrow(/permission denied/);
    await expect(rows(U.outsider, 'select * from public.gym_join_attempts')).rejects.toThrow(
      /permission denied/
    );
  });
});
