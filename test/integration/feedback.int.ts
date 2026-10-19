/**
 * Gerçek sunucu — salon geri bildirimi (v3.6d, 0013_feedback.sql).
 * Uygulamanın kendi fonksiyonlarıyla (src/lib/feedback.ts), her rolün
 * kendi oturumuyla. En önemlisi: anonim kayıtta yönetici yazarın kim
 * olduğunu hiçbir yoldan (tablo, RPC, Storage) öğrenemez.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FEEDBACK_BUCKET,
  answerFeedback,
  deleteFeedback,
  fetchGymFeedback,
  fetchMyFeedback,
  photoObjectPath,
  submitFeedback,
  type FeedbackInput,
} from '@/lib/feedback';

import { admin, createUser, deleteCreatedUsers, env, signedIn, stopAppClients, type AppClient, type TestUser } from './support';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () =>
  Array.from(randomBytes(8))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');

type Key = 'admin' | 'trainer' | 'author' | 'other' | 'outsider' | 'leaver';
const KEYS: Key[] = ['admin', 'trainer', 'author', 'other', 'outsider', 'leaver'];
const u = {} as Record<Key, TestUser>;
const c = {} as Record<Key, AppClient>;
const gyms = {} as Record<'A' | 'B', string>;

/** Küçük JPEG başlığı (içerik denetlenmiyor; tür ve boyut sınırı bucket'ta) */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(64), 0xff, 0xd9]);
const fileId = () => randomUUID().replace(/-/g, '');

async function createGym(name: string) {
  const { data, error } = await admin.from('gyms').insert({ name: `INT ${name}`, join_code: joinCode() }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

function value<T>(r: { ok: true; value: T } | { ok: false; error: { kind: string } }): T {
  if (!r.ok) throw new Error(r.error.kind);
  return r.value;
}

const input = (over: Partial<FeedbackInput> = {}): FeedbackInput => ({
  gymId: gyms.A,
  category: 'equipment',
  body: 'Squat rack emniyet pimi eksik.',
  anonymous: false,
  photo: null,
  ...over,
});

async function serverRow(id: string) {
  const { data, error } = await admin.from('gym_feedback').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

/** storage.objects'teki yükleyen (owner_id) — API'de yok, test veritabanından doğrudan */
async function storageOwners(paths: string[]): Promise<Record<string, string | null>> {
  const db = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<{ name: string; owner_id: string | null }>(
      "select name, owner_id from storage.objects where bucket_id = 'gym-feedback' and name = any($1)",
      [paths]
    );
    return Object.fromEntries(rows.map((r) => [r.name, r.owner_id]));
  } finally {
    await db.end();
  }
}

async function canDownload(who: Key, path: string): Promise<boolean> {
  const { data, error } = await c[who].client.storage.from(FEEDBACK_BUCKET).download(path);
  return !error && data != null;
}

beforeAll(async () => {
  gyms.A = await createGym('Geri bildirim A');
  gyms.B = await createGym('Geri bildirim B');
  for (const k of KEYS) u[k] = await createUser(`fb-${k}`);
  await admin.from('gym_members').insert([
    { gym_id: gyms.A, user_id: u.admin.id, role: 'admin' },
    { gym_id: gyms.A, user_id: u.trainer.id, role: 'trainer' },
    { gym_id: gyms.A, user_id: u.author.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.other.id, role: 'member' },
    { gym_id: gyms.A, user_id: u.leaver.id, role: 'member' },
    { gym_id: gyms.B, user_id: u.outsider.id, role: 'admin' },
  ]);
  for (const k of KEYS) c[k] = await signedIn(u[k]);
  await admin.from('profiles').upsert({ id: u.author.id, display_name: 'Ayşe' });
});

afterAll(async () => {
  await stopAppClients();
  const { data } = await admin.storage.from(FEEDBACK_BUCKET).list(gyms.A);
  const paths = (data ?? []).map((o) => `${gyms.A}/${o.name}`);
  if (paths.length > 0) await admin.storage.from(FEEDBACK_BUCKET).remove(paths);
  await deleteCreatedUsers();
  await admin.from('gyms').delete().in('id', [gyms.A, gyms.B].filter(Boolean));
});

describe('geri bildirim', () => {
  let named: string;
  let namedPhoto: string;
  let anon: string;
  let anonPhoto: string;

  it('üye yazar (fotoğraflı) ve kendi kayıtlarını görür; başkası göremez', async () => {
    named = value(await submitFeedback(c.author.client, input({ photo: { bytes: JPEG, fileId: fileId() } })));
    const row = await serverRow(named);
    expect(row).toMatchObject({ author_id: u.author.id, anonymous: false, status: 'new', category: 'equipment' });
    namedPhoto = row!.photo_path as string;
    expect(namedPhoto.startsWith(`${gyms.A}/`)).toBe(true);

    const mine = value(await fetchMyFeedback(c.author.client));
    expect(mine.map((f) => f.id)).toEqual([named]);
    expect(value(await fetchMyFeedback(c.other.client))).toEqual([]);
    expect(value(await fetchMyFeedback(c.trainer.client))).toEqual([]);
  });

  it('anonim kayıt: yönetici yazarı tablodan, RPC\'den ve Storage\'dan öğrenemez', async () => {
    anon = value(
      await submitFeedback(
        c.author.client,
        input({ category: 'staff', body: 'Gece görevlisi üyelere kaba davranıyor.', anonymous: true, photo: { bytes: JPEG, fileId: fileId() } })
      )
    );
    anonPhoto = (await serverRow(anon))!.photo_path as string;
    // Yazar kendi anonim kaydını görür
    expect(value(await fetchMyFeedback(c.author.client)).map((f) => f.id)).toContain(anon);

    // RPC: yazar alanları boş; yanıtın hiçbir yerinde yazar kimliği yok
    const { data: raw, error } = await c.admin.client.rpc('feedback_list', { p_gym_id: gyms.A });
    expect(error).toBeNull();
    const anonRaw = (raw as Record<string, unknown>[]).find((r) => r.id === anon)!;
    expect(anonRaw.author_id).toBeNull();
    expect(anonRaw.author_name).toBeNull();
    expect(JSON.stringify(anonRaw)).not.toContain(u.author.id);
    expect(JSON.stringify(anonRaw)).not.toContain('Ayşe');
    // Anonim olmayan kayıtta ad görünür
    const list = value(await fetchGymFeedback(c.admin.client, gyms.A));
    expect(list.find((f) => f.id === named)).toMatchObject({ authorId: u.author.id, authorName: 'Ayşe' });
    expect(list.find((f) => f.id === anon)).toMatchObject({ authorId: null, authorName: null, anonymous: true });

    // Tablo: yönetici hiçbir satırı okuyamaz (author_id sütunu dahil)
    const direct = await c.admin.client.from('gym_feedback').select('id, author_id');
    expect(direct.data ?? []).toEqual([]);
    const filtered = await c.admin.client.from('gym_feedback').select('id').eq('author_id', u.author.id);
    expect(filtered.data ?? []).toEqual([]);

    // Storage: liste ve nesne bilgisinde yükleyen yok; sunucudaki kayıtta da silindi
    const folder = await c.admin.client.storage.from(FEEDBACK_BUCKET).list(gyms.A);
    expect(folder.error).toBeNull();
    const listed = (folder.data ?? []).find((o) => `${gyms.A}/${o.name}` === anonPhoto);
    expect(listed).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(u.author.id);
    const info = await c.admin.client.storage.from(FEEDBACK_BUCKET).info(anonPhoto);
    if (!info.error) expect(JSON.stringify(info.data)).not.toContain(u.author.id);
    // Storage API'nin nesne bilgisi yükleyeni hiç döndürmüyor
    const serviceInfo = await admin.storage.from(FEEDBACK_BUCKET).info(anonPhoto);
    expect(serviceInfo.error).toBeNull();
    expect(JSON.stringify(serviceInfo.data)).not.toContain(u.author.id);
    // Veritabanında da: anonim nesnenin sahibi silindi, isimlininki duruyor
    const owners = await storageOwners([namedPhoto, anonPhoto]);
    expect(owners[namedPhoto]).toBe(u.author.id);
    expect(owners[anonPhoto]).toBeNull();
    // Dosya adı kimlik içermiyor
    expect(anonPhoto).not.toContain(u.author.id);
  });

  it('fotoğrafı yalnızca yazar ve yönetici okur', async () => {
    for (const path of [namedPhoto, anonPhoto]) {
      expect(await canDownload('author', path), `yazar ${path}`).toBe(true);
      expect(await canDownload('admin', path), `yönetici ${path}`).toBe(true);
      for (const who of ['other', 'trainer', 'outsider'] as const) {
        expect(await canDownload(who, path), `${who} ${path}`).toBe(false);
      }
    }
  });

  it('başkasının fotoğrafı bağlanamaz; üye olmayan salona yükleyemez / yazamaz', async () => {
    const { error } = await c.other.client.rpc('submit_feedback', {
      p_gym_id: gyms.A,
      p_category: 'other',
      p_body: 'Başkasının fotoğrafı',
      p_anonymous: false,
      p_photo_path: namedPhoto,
    });
    expect(error?.message).toContain('feedback_invalid');
    const upload = await c.outsider.client.storage
      .from(FEEDBACK_BUCKET)
      .upload(photoObjectPath(gyms.A, fileId()), JPEG, { contentType: 'image/jpeg' });
    expect(upload.error).not.toBeNull();
    const r = await submitFeedback(c.outsider.client, input());
    expect(!r.ok && r.error.kind).toBe('forbidden');
  });

  it('hoca ve başka salon göremez; yalnızca yönetici listeler', async () => {
    for (const who of ['trainer', 'author', 'outsider'] as const) {
      const r = await fetchGymFeedback(c[who].client, gyms.A);
      expect(!r.ok && r.error.kind, who).toBe('forbidden');
    }
    expect((await c.trainer.client.from('gym_feedback').select('id')).data ?? []).toEqual([]);
    expect(value(await fetchGymFeedback(c.outsider.client, gyms.B))).toEqual([]);
  });

  it('yönetici durum ve yanıt yazar; yazar görür; geçersiz geçiş ve yetkisiz yanıt reddedilir', async () => {
    value(await answerFeedback(c.admin.client, anon, 'in_progress', 'Görevliyle konuşuyoruz.'));
    const mine = value(await fetchMyFeedback(c.author.client)).find((f) => f.id === anon)!;
    expect(mine).toMatchObject({ status: 'in_progress', reply: 'Görevliyle konuşuyoruz.' });
    expect((await serverRow(anon))!.replied_by).toBe(u.admin.id);

    value(await answerFeedback(c.admin.client, anon, 'resolved', 'Görevliyle konuşuyoruz.'));
    const back = await answerFeedback(c.admin.client, anon, 'new', '');
    expect(!back.ok && back.error.kind).toBe('feedback_invalid');

    for (const who of ['trainer', 'author', 'outsider'] as const) {
      const r = await answerFeedback(c[who].client, named, 'resolved', 'olmaz');
      expect(!r.ok && r.error.kind, who).toBe('forbidden');
    }
    // Uzun yanıt
    const long = await answerFeedback(c.admin.client, named, 'in_progress', 'x'.repeat(1001));
    expect(!long.ok && long.error.kind).toBe('feedback_invalid');
  });

  it('kısa metin ve geçersiz kategori sunucuda reddedilir', async () => {
    const short = await submitFeedback(c.other.client, input({ body: ' abc ' }));
    expect(!short.ok && short.error.kind).toBe('feedback_invalid');
    const { error } = await c.other.client.rpc('submit_feedback', {
      p_gym_id: gyms.A,
      p_category: 'uzay',
      p_body: 'Yeterince uzun bir metin',
      p_anonymous: false,
    });
    expect(error?.message).toContain('feedback_invalid');
  });

  it('günlük sınır: üye başına günde 5', async () => {
    // Yazarın bugün 2 kaydı var
    for (let i = 0; i < 3; i++) value(await submitFeedback(c.author.client, input({ body: `Sınır denemesi ${i + 1}` })));
    const sixth = await submitFeedback(c.author.client, input({ body: 'Altıncı kayıt' }));
    expect(!sixth.ok && sixth.error.kind).toBe('feedback_daily_limit');
    // Başka üyeyi etkilemez
    value(await submitFeedback(c.other.client, input({ body: 'Benim ilk kaydım' })));
  });

  it('silinince fotoğraf da silinir (yazar ya da yönetici); başkası silemez', async () => {
    const foreign = await deleteFeedback(c.other.client, { id: named, photoPath: null });
    expect(!foreign.ok && foreign.error.kind).toBe('forbidden');

    value(await deleteFeedback(c.author.client, { id: named, photoPath: namedPhoto }));
    expect(await serverRow(named)).toBeNull();
    expect((await admin.storage.from(FEEDBACK_BUCKET).download(namedPhoto)).error).not.toBeNull();

    value(await deleteFeedback(c.admin.client, { id: anon, photoPath: anonPhoto }));
    expect(await serverRow(anon)).toBeNull();
    expect((await admin.storage.from(FEEDBACK_BUCKET).download(anonPhoto)).error).not.toBeNull();
  });

  it('hesap silinince kayıt kalır, yazar bağı kopar', async () => {
    const id = value(await submitFeedback(c.leaver.client, input({ category: 'cleanliness', body: 'Soyunma odası kirli.' })));
    const { error } = await admin.auth.admin.deleteUser(u.leaver.id);
    expect(error).toBeNull();
    expect(await serverRow(id)).toMatchObject({ author_id: null, body: 'Soyunma odası kirli.' });
    const row = value(await fetchGymFeedback(c.admin.client, gyms.A)).find((f) => f.id === id);
    expect(row).toMatchObject({ authorId: null, authorName: null });
  });
});
