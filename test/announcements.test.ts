/**
 * Salon duyuruları (v3.2b) — saf mantık (src/lib/announcements.ts):
 * sıralama, öne çıkan, okunmamış, önbellek, form doğrulaması, "yeni
 * duyuru" olayı, görünüm yetkileri, hata eşleme. Sunucu kuralları:
 * test/integration/announcements.int.ts (gerçek test projesi).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  BODY_MAX,
  TITLE_MAX,
  canManage,
  canPin,
  charCount,
  createAnnouncement,
  deleteAnnouncement,
  draftError,
  emitNewAnnouncements,
  featuredAnnouncement,
  fetchAnnouncements,
  findNewAnnouncements,
  isDraftDirty,
  isUnread,
  onNewAnnouncements,
  parseAnnouncementRows,
  readCache,
  readLastSeen,
  sortAnnouncements,
  unreadCount,
  updateAnnouncement,
  writableGyms,
  writeCache,
  writeLastSeen,
  type Announcement,
  type KeyValueStore,
} from '@/lib/announcements';
import { ACCOUNT_ERROR_MESSAGES, classifyAccountError } from '@/lib/auth';

const a = (id: string, createdAt: string, extra: Partial<Announcement> = {}): Announcement => ({
  id,
  gymId: 'g1',
  authorId: 'trainer',
  title: `Başlık ${id}`,
  body: `Metin ${id}`,
  pinned: false,
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

const OLD = a('eski', '2026-10-01T10:00:00.000Z');
const MID = a('orta', '2026-10-05T10:00:00.000Z');
const NEW = a('yeni', '2026-10-10T10:00:00.000Z');
const PINNED = a('sabit', '2026-09-01T10:00:00.000Z', { pinned: true });

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
  };
}

describe('sıralama ve öne çıkan', () => {
  it('sabitlenmişler üstte, sonra yeniden eskiye', () => {
    const pinnedNew = a('sabit-yeni', '2026-10-11T10:00:00.000Z', { pinned: true });
    expect(sortAnnouncements([OLD, PINNED, NEW, MID, pinnedNew]).map((x) => x.id)).toEqual([
      'sabit-yeni',
      'sabit',
      'yeni',
      'orta',
      'eski',
    ]);
  });

  it('ana sayfa kartı: sabitlenmiş varsa o, yoksa en yenisi, yoksa hiçbiri', () => {
    expect(featuredAnnouncement([OLD, NEW, PINNED])?.id).toBe('sabit');
    expect(featuredAnnouncement([OLD, NEW, MID])?.id).toBe('yeni');
    expect(featuredAnnouncement([])).toBeNull();
  });
});

describe('okunmamış', () => {
  it('son açılıştan sonra yazılanlar; ekran hiç açılmadıysa hepsi', () => {
    const seen = '2026-10-05T12:00:00.000Z';
    expect(isUnread(NEW, seen)).toBe(true);
    expect(isUnread(MID, seen)).toBe(false);
    expect(unreadCount([OLD, MID, NEW], seen)).toBe(1);
    expect(unreadCount([OLD, MID, NEW], null)).toBe(3);
    expect(unreadCount([], null)).toBe(0);
  });

  it('düzenlenen eski duyuru yeniden okunmamış olmuyor (yalnızca yazılma zamanı)', () => {
    const edited = { ...OLD, updatedAt: '2026-10-12T00:00:00.000Z' };
    expect(isUnread(edited, '2026-10-05T12:00:00.000Z')).toBe(false);
  });
});

describe('önbellek ve son açılış (kv-store)', () => {
  it('yaz → oku aynı liste; kullanıcıya göre ayrı', async () => {
    const store = memoryStore();
    await writeCache(store, 'u1', { fetchedAt: '2026-10-12T10:00:00.000Z', items: [PINNED, NEW] });
    expect(await readCache(store, 'u1')).toEqual({ fetchedAt: '2026-10-12T10:00:00.000Z', items: [PINNED, NEW] });
    expect(await readCache(store, 'u2')).toBeNull();

    await writeLastSeen(store, 'u1', '2026-10-12T11:00:00.000Z');
    expect(await readLastSeen(store, 'u1')).toBe('2026-10-12T11:00:00.000Z');
    expect(await readLastSeen(store, 'u2')).toBeNull();
  });

  it('bozuk önbellek ve bozuk satırlar sessizce atlanıyor', async () => {
    const store = memoryStore();
    store.data.set('announcements.cache.u1', '{bozuk');
    expect(await readCache(store, 'u1')).toBeNull();
    store.data.set('announcements.cache.u1', JSON.stringify({ fetchedAt: 'x', items: [NEW, { id: 1 }, null] }));
    expect((await readCache(store, 'u1'))?.items).toEqual([NEW]);
    store.data.set('announcements.lastSeen.u1', 'tarih değil');
    expect(await readLastSeen(store, 'u1')).toBeNull();
  });

  it('depo okunamazsa çökmüyor', async () => {
    const broken: KeyValueStore = {
      getItem: async () => {
        throw new Error('disk');
      },
      setItem: async () => {},
    };
    expect(await readCache(broken, 'u1')).toBeNull();
    expect(await readLastSeen(broken, 'u1')).toBeNull();
  });
});

describe('form doğrulaması', () => {
  it('başlık ve metin boş olamaz, sınırlar 80 / 1000, boşluklar sayılmaz', () => {
    expect(draftError({ title: '', body: 'x' })).toBe('Başlık boş olamaz.');
    expect(draftError({ title: '   ', body: 'x' })).toBe('Başlık boş olamaz.');
    expect(draftError({ title: 'x', body: ' \n ' })).toBe('Metin boş olamaz.');
    expect(draftError({ title: 'x'.repeat(TITLE_MAX), body: 'y'.repeat(BODY_MAX) })).toBeNull();
    expect(draftError({ title: 'x'.repeat(TITLE_MAX + 1), body: 'y' })).toMatch(/80/);
    expect(draftError({ title: 'x', body: 'y'.repeat(BODY_MAX + 1) })).toMatch(/1000/);
    expect(draftError({ title: `  ${'x'.repeat(TITLE_MAX)}  `, body: 'y' })).toBeNull();
  });

  it('sayaç sunucu gibi sayıyor: emoji tek karakter', () => {
    expect(charCount('💪💪')).toBe(2);
    expect('💪💪'.length).toBe(4);
    expect(draftError({ title: '💪'.repeat(TITLE_MAX), body: 'y' })).toBeNull();
  });

  it('kaydedilmemiş değişiklik ("Vazgeçilsin mi?")', () => {
    const original = { title: 'Başlık', body: 'Metin', pinned: false };
    expect(isDraftDirty({ ...original }, original)).toBe(false);
    expect(isDraftDirty({ ...original, title: 'Başlık  ' }, original)).toBe(false);
    expect(isDraftDirty({ ...original, body: 'Metin!' }, original)).toBe(true);
    expect(isDraftDirty({ ...original, pinned: true }, original)).toBe(true);
    expect(isDraftDirty({ title: '', body: '', pinned: false }, null)).toBe(false);
    expect(isDraftDirty({ title: 'x', body: '', pinned: false }, null)).toBe(true);
  });
});

describe('görünüm yetkileri (yetkiyi sunucu belirler)', () => {
  const ms = [
    { gymId: 'g1', role: 'trainer' as const },
    { gymId: 'g2', role: 'admin' as const },
    { gymId: 'g3', role: 'member' as const },
  ];

  it('yazabileceği salonlar: hoca ve yönetici olduğu', () => {
    expect(writableGyms(ms).map((m) => m.gymId)).toEqual(['g1', 'g2']);
  });

  it('hoca kendi duyurusunu, yönetici hepsini yönetir; üye hiçbirini', () => {
    expect(canManage({ gymId: 'g1', authorId: 'me' }, 'me', ms)).toBe(true);
    expect(canManage({ gymId: 'g1', authorId: 'other' }, 'me', ms)).toBe(false);
    expect(canManage({ gymId: 'g2', authorId: 'other' }, 'me', ms)).toBe(true);
    expect(canManage({ gymId: 'g2', authorId: null }, 'me', ms)).toBe(true);
    expect(canManage({ gymId: 'g3', authorId: 'me' }, 'me', ms)).toBe(false);
    expect(canManage({ gymId: 'gX', authorId: 'me' }, 'me', ms)).toBe(false);
  });

  it('sabitleme yalnızca yönetici', () => {
    expect(canPin('g2', ms)).toBe(true);
    expect(canPin('g1', ms)).toBe(false);
    expect(canPin('g3', ms)).toBe(false);
  });
});

describe('"yeni duyuru" olayı (push için tek kaynak)', () => {
  it('ilk çekmede hiçbiri yeni değil; sonra önceki listede olmayan ve okunmamış olanlar', () => {
    expect(findNewAnnouncements(null, [NEW], null)).toEqual([]);
    expect(findNewAnnouncements([OLD], [OLD, NEW], '2026-10-05T12:00:00.000Z')).toEqual([NEW]);
    // Önceki listede yoktu ama zaten görülmüş (eski): yeni sayılmaz
    expect(findNewAnnouncements([NEW], [NEW, MID], '2026-10-06T00:00:00.000Z')).toEqual([]);
  });

  it('dinleyiciler çağrılıyor; hatalı dinleyici ötekileri durdurmuyor; abonelik kaldırılabiliyor', () => {
    const got: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const off1 = onNewAnnouncements(() => {
      throw new Error('bozuk');
    });
    const off2 = onNewAnnouncements((items) => got.push(...items.map((x) => x.id)));
    emitNewAnnouncements([NEW]);
    emitNewAnnouncements([]);
    off2();
    emitNewAnnouncements([MID]);
    off1();
    warn.mockRestore();
    expect(got).toEqual(['yeni']);
  });
});

describe('sunucu satırları ve hatalar', () => {
  it('satırlar uygulama tipine; bozuklar atlanıyor', () => {
    expect(
      parseAnnouncementRows([
        {
          id: 'x',
          gym_id: 'g',
          author_id: null,
          title: 'T',
          body: 'B',
          pinned: true,
          created_at: '2026-10-12T10:00:00+00:00',
          updated_at: '2026-10-12T10:00:00+00:00',
        },
        { id: 'y' },
      ])
    ).toEqual([
      {
        id: 'x',
        gymId: 'g',
        authorId: null,
        title: 'T',
        body: 'B',
        pinned: true,
        createdAt: '2026-10-12T10:00:00+00:00',
        updatedAt: '2026-10-12T10:00:00+00:00',
      },
    ]);
    expect(parseAnnouncementRows(null)).toEqual([]);
  });

  it('sunucu hataları ayrı mesajla', () => {
    expect(classifyAccountError({ code: '42501', message: 'new row violates row-level security policy' })).toBe(
      'forbidden'
    );
    expect(classifyAccountError({ code: 'P0001', message: 'only_admin_can_pin' })).toBe('pin_admin_only');
    expect(classifyAccountError({ code: '23514', message: 'violates check constraint' })).toBe('invalid_input');
    expect(ACCOUNT_ERROR_MESSAGES.pin_admin_only).toMatch(/yönetici/);
  });

  it('istemci yoksa ağa çıkmıyor', async () => {
    for (const r of await Promise.all([
      fetchAnnouncements(null),
      createAnnouncement(null, 'g', { title: 'T', body: 'B', pinned: false }),
      updateAnnouncement(null, 'x', { title: 'T' }),
      deleteAnnouncement(null, 'x'),
    ])) {
      expect(r).toMatchObject({ ok: false, error: { kind: 'not_configured' } });
    }
  });

  it('RLS satırı süzerse (hata yok, satır yok) "yetkin yok"', async () => {
    const chain = {
      update: () => chain,
      delete: () => chain,
      eq: () => chain,
      select: async () => ({ data: [], error: null }),
    };
    const client = { from: () => chain } as unknown as Parameters<typeof updateAnnouncement>[0];
    expect(await updateAnnouncement(client, 'x', { title: 'T' })).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    expect(await deleteAnnouncement(client, 'x')).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });
});
