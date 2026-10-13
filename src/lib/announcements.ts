/**
 * Salon duyuruları (v3.2b) — saf mantık + Supabase çağrıları.
 * Sunucu: supabase/migrations/0004_announcements.sql (yetkiyi sunucu
 * belirler; buradaki rol kontrolleri yalnızca görünüm için).
 *
 * - Sıralama: sabitlenmişler üstte, sonra yeniden eskiye.
 * - Okunmamış: duyurular ekranının son açılışından (telefonda) sonra
 *   yazılanlar. Okundu bilgisi sunucuya gönderilmez (KVKK).
 * - Önbellek: son çekilen liste telefonda (kv-store); internetsizken o.
 * - "Yeni duyuru" olayı tek yerden çıkıyor (`findNewAnnouncements` +
 *   `onNewAnnouncements`): push bildirim eklenince oraya bağlanacak.
 *
 * Fonksiyonlar fırlatmaz; account.ts'teki gibi `AccountResult` döner.
 * React ve Expo bilmez; test/announcements.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult, GymMembership } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';

export const TITLE_MAX = 80;
export const BODY_MAX = 1000;

export interface Announcement {
  id: string;
  gymId: string;
  authorId: string | null;
  /** Yazarın adı (0007 announcement_author_names); yoksa null */
  authorName: string | null;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Saf mantık
// ============================================================================

/** Sunucu satırları → uygulama tipi; bozuk satırlar atlanır */
export function parseAnnouncementRows(data: unknown): Announcement[] {
  if (!Array.isArray(data)) return [];
  const out: Announcement[] = [];
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    if (
      typeof r?.id !== 'string' ||
      typeof r.gym_id !== 'string' ||
      typeof r.title !== 'string' ||
      typeof r.body !== 'string' ||
      typeof r.created_at !== 'string'
    ) {
      continue;
    }
    out.push({
      id: r.id,
      gymId: r.gym_id,
      authorId: typeof r.author_id === 'string' ? r.author_id : null,
      authorName: typeof r.author_name === 'string' && r.author_name.trim() ? r.author_name : null,
      title: r.title,
      body: r.body,
      pinned: r.pinned === true,
      createdAt: r.created_at,
      updatedAt: typeof r.updated_at === 'string' ? r.updated_at : r.created_at,
    });
  }
  return out;
}

const time = (iso: string) => Date.parse(iso) || 0;

/** Sabitlenmişler üstte, sonra yeniden eskiye */
export function sortAnnouncements(list: readonly Announcement[]): Announcement[] {
  return [...list].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || time(b.createdAt) - time(a.createdAt) || (a.id < b.id ? -1 : 1)
  );
}

/** Ana sayfa kartı: sabitlenmiş varsa o, yoksa en yenisi */
export function featuredAnnouncement(list: readonly Announcement[]): Announcement | null {
  return sortAnnouncements(list)[0] ?? null;
}

/** Ekranın son açılışından sonra yazılan; hiç açılmadıysa hepsi */
export function isUnread(a: Announcement, lastSeenAt: string | null): boolean {
  return lastSeenAt == null || time(a.createdAt) > time(lastSeenAt);
}

export function unreadCount(list: readonly Announcement[], lastSeenAt: string | null): number {
  return list.filter((a) => isUnread(a, lastSeenAt)).length;
}

/** Sunucu gibi say: kod noktası (emoji 1 karakter) */
export function charCount(text: string): number {
  return [...text].length;
}

export interface AnnouncementDraft {
  title: string;
  body: string;
  pinned: boolean;
}

/** Form doğrulaması; geçerliyse null */
export function draftError(draft: Pick<AnnouncementDraft, 'title' | 'body'>): string | null {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (title.length === 0) return 'Başlık boş olamaz.';
  if (charCount(title) > TITLE_MAX) return `Başlık en fazla ${TITLE_MAX} karakter olabilir.`;
  if (body.length === 0) return 'Metin boş olamaz.';
  if (charCount(body) > BODY_MAX) return `Metin en fazla ${BODY_MAX} karakter olabilir.`;
  return null;
}

/** Kaydedilmemiş değişiklik var mı (çıkarken "Vazgeçilsin mi?") */
export function isDraftDirty(draft: AnnouncementDraft, original: AnnouncementDraft | null): boolean {
  const base = original ?? { title: '', body: '', pinned: false };
  return (
    draft.title.trim() !== base.title.trim() ||
    draft.body.trim() !== base.body.trim() ||
    draft.pinned !== base.pinned
  );
}

type Role = GymMembership['role'];

function roleIn(memberships: readonly Pick<GymMembership, 'gymId' | 'role'>[], gymId: string): Role | null {
  return memberships.find((m) => m.gymId === gymId)?.role ?? null;
}

/** Görünüm için: duyuru yazabileceği salonlar (hoca / yönetici) */
export function writableGyms<T extends Pick<GymMembership, 'gymId' | 'role'>>(memberships: readonly T[]): T[] {
  return memberships.filter((m) => m.role === 'trainer' || m.role === 'admin');
}

/** Görünüm için: düzenle / sil gösterilsin mi (yetkiyi sunucu belirler) */
export function canManage(
  a: Pick<Announcement, 'gymId' | 'authorId'>,
  userId: string | null,
  memberships: readonly Pick<GymMembership, 'gymId' | 'role'>[]
): boolean {
  const role = roleIn(memberships, a.gymId);
  if (role === 'admin') return true;
  return role === 'trainer' && userId != null && a.authorId === userId;
}

export function canPin(gymId: string, memberships: readonly Pick<GymMembership, 'gymId' | 'role'>[]): boolean {
  return roleIn(memberships, gymId) === 'admin';
}

// ============================================================================
// Önbellek ve son açılış (kv-store)
// ============================================================================

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface AnnouncementCache {
  fetchedAt: string;
  items: Announcement[];
}

export const cacheKey = (userId: string) => `announcements.cache.${userId}`;
export const lastSeenKey = (userId: string) => `announcements.lastSeen.${userId}`;

export async function readCache(store: KeyValueStore, userId: string): Promise<AnnouncementCache | null> {
  try {
    const raw = await store.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; items?: unknown };
    if (typeof parsed.fetchedAt !== 'string' || !Array.isArray(parsed.items)) return null;
    // Önbellekteki biçim de uygulama tipi: aynı denetimden geçsin
    const items = parseAnnouncementRows(
      (parsed.items as Announcement[]).map((a) => ({
        id: a?.id,
        gym_id: a?.gymId,
        author_id: a?.authorId,
        author_name: a?.authorName,
        title: a?.title,
        body: a?.body,
        pinned: a?.pinned,
        created_at: a?.createdAt,
        updated_at: a?.updatedAt,
      }))
    );
    return { fetchedAt: parsed.fetchedAt, items };
  } catch {
    return null;
  }
}

export async function writeCache(store: KeyValueStore, userId: string, cache: AnnouncementCache): Promise<void> {
  await store.setItem(cacheKey(userId), JSON.stringify(cache));
}

export async function readLastSeen(store: KeyValueStore, userId: string): Promise<string | null> {
  try {
    const raw = await store.getItem(lastSeenKey(userId));
    return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

export async function writeLastSeen(store: KeyValueStore, userId: string, iso: string): Promise<void> {
  await store.setItem(lastSeenKey(userId), iso);
}

// ============================================================================
// "Yeni duyuru" olayı (push bildirimi için tek kaynak)
// ============================================================================

/**
 * Önceki listede olmayan ve son açılıştan sonra yazılanlar. İlk çekmede
 * (önceki liste yok) hiçbiri "yeni" sayılmaz: uygulama ilk açıldığında
 * eski duyurular için bildirim çıkmasın.
 */
export function findNewAnnouncements(
  previous: readonly Announcement[] | null,
  next: readonly Announcement[],
  lastSeenAt: string | null
): Announcement[] {
  if (previous == null) return [];
  const known = new Set(previous.map((a) => a.id));
  return next.filter((a) => !known.has(a.id) && isUnread(a, lastSeenAt));
}

type NewAnnouncementsListener = (items: Announcement[]) => void;
const listeners = new Set<NewAnnouncementsListener>();

/** Push bildirim gelince buraya bağlanacak; dönüş: aboneliği kaldır */
export function onNewAnnouncements(listener: NewAnnouncementsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitNewAnnouncements(items: Announcement[]): void {
  if (items.length === 0) return;
  for (const l of listeners) {
    try {
      l(items);
    } catch (err) {
      console.warn('[ANNOUNCEMENTS] Dinleyici hatası:', err);
    }
  }
}

// ============================================================================
// Supabase
// ============================================================================

const ok = <T>(value: T): AccountResult<T> => ({ ok: true, value });
const fail = <T>(kind: Parameters<typeof accountError>[0]): AccountResult<T> => ({
  ok: false,
  error: accountError(kind),
});

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return fail('not_configured');
  try {
    return await fn(client);
  } catch (err) {
    console.error('[ANNOUNCEMENTS] HATA:', err);
    return { ok: false, error: toAccountError(err) };
  }
}

const COLUMNS = 'id, gym_id, author_id, title, body, pinned, created_at, updated_at';

/** Üyesi olunan bütün salonların duyuruları (RLS süzüyor), sıralı */
export function fetchAnnouncements(client: SupabaseClient | null) {
  return run(client, async (c) => {
    const { data, error } = await c
      .from('announcements')
      .select(COLUMNS)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return { ok: false, error: toAccountError(error) } as AccountResult<Announcement[]>;
    // Yazar adları ayrı (üye profilleri göremez; RPC yalnızca yazarları verir).
    // Alınamazsa duyurular adsız gösterilir.
    const names = await c.rpc('announcement_author_names');
    if (names.error) console.warn('[ANNOUNCEMENTS] Yazar adları alınamadı:', names.error.message);
    const byId = new Map<string, string>();
    for (const r of (names.data ?? []) as { announcement_id?: unknown; author_name?: unknown }[]) {
      if (typeof r.announcement_id === 'string' && typeof r.author_name === 'string') {
        byId.set(r.announcement_id, r.author_name);
      }
    }
    const rows = (Array.isArray(data) ? data : []).map((row) => ({
      ...(row as Record<string, unknown>),
      author_name: byId.get((row as { id?: string }).id ?? '') ?? null,
    }));
    return ok(sortAnnouncements(parseAnnouncementRows(rows)));
  });
}

function clean(draft: Partial<AnnouncementDraft>) {
  return {
    ...(draft.title !== undefined ? { title: draft.title.trim() } : {}),
    ...(draft.body !== undefined ? { body: draft.body.trim() } : {}),
    ...(draft.pinned !== undefined ? { pinned: draft.pinned } : {}),
  };
}

export function createAnnouncement(client: SupabaseClient | null, gymId: string, draft: AnnouncementDraft) {
  return run(client, async (c) => {
    const { data, error } = await c
      .from('announcements')
      .insert({ gym_id: gymId, ...clean(draft) })
      .select(COLUMNS)
      .single();
    if (error) return { ok: false, error: toAccountError(error) } as AccountResult<Announcement>;
    const [row] = parseAnnouncementRows([data]);
    return row ? ok(row) : fail<Announcement>('unknown');
  });
}

/**
 * Düzenleme. RLS izin vermezse satır güncellenmez ve hata gelmez;
 * dönen satır yoksa "yetkin yok".
 */
export function updateAnnouncement(client: SupabaseClient | null, id: string, patch: Partial<AnnouncementDraft>) {
  return run(client, async (c) => {
    const { data, error } = await c.from('announcements').update(clean(patch)).eq('id', id).select(COLUMNS);
    if (error) return { ok: false, error: toAccountError(error) } as AccountResult<Announcement>;
    const [row] = parseAnnouncementRows(data);
    return row ? ok(row) : fail<Announcement>('forbidden');
  });
}

/** Silme; RLS izin vermezse silinen satır olmaz → "yetkin yok" */
export function deleteAnnouncement(client: SupabaseClient | null, id: string) {
  return run(client, async (c) => {
    const { data, error } = await c.from('announcements').delete().eq('id', id).select('id');
    if (error) return { ok: false, error: toAccountError(error) } as AccountResult<null>;
    return Array.isArray(data) && data.length > 0 ? ok(null) : fail<null>('forbidden');
  });
}
