/**
 * Push bildirim (v3.3) — uygulama tarafının saf mantığı: token kaydı,
 * bildirim tercihleri, bildirime dokununca açılacak ekran.
 *
 * Expo / native çağrıları `pushNative.ts`'te. Gönderim sunucuda
 * (supabase/functions/notify); veri biçimi ve kanal kimlikleri oradan
 * geliyor, iki taraf aynı sözleşmeyi kullanıyor.
 *
 * - Token yalnızca gizli bayrak açık + giriş yapılmış + bir salona
 *   üyeyken ve bildirim izni varken kaydedilir; izin yoksa sessizce
 *   atlanır.
 * - Kayıt telefonda da tutulur (kullanıcı, token, zaman): aynı kullanıcı
 *   ve token için günde en fazla bir kez sunucuya gidilir.
 * - Çıkışta ve hesap silinince kayıt telefondan da silinir (sunucudaki
 *   satırı çıkış siler, hesap silmede cascade).
 *
 * Sunucu: supabase/migrations/0009_push.sql.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  CHANNEL_ANNOUNCEMENTS,
  CHANNEL_CLASS_CHANGES,
  CHANNEL_TRAINER,
  PUSH_TYPE_ANNOUNCEMENT,
  PUSH_TYPE_CLASS_CHANGE,
  PUSH_TYPE_TRAINER_ACCEPTED,
  PUSH_TYPE_TRAINER_REQUEST,
  type PushData,
} from '../../supabase/functions/notify/logic';
import type { AccountResult } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';
import type { RemovableKeyValueStore } from '@/lib/weeklyGoal';

export type { PushData };

// ============================================================================
// Kanallar ve bildirime dokunma
// ============================================================================

/** Android bildirim kanalları. Kimlikleri değiştirme: kullanıcı ayarları kanala bağlı. */
export const PUSH_CHANNELS = [
  { id: CHANNEL_ANNOUNCEMENTS, name: 'Duyurular', description: 'Salonundan yeni duyurular' },
  { id: CHANNEL_CLASS_CHANGES, name: 'Dersler', description: 'Katılacağın dersin iptali ya da değişikliği' },
  { id: CHANNEL_TRAINER, name: 'Hoca', description: 'Hoca istekleri ve kabulleri' },
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** Bildirim verisi bizim push bildirimimiz mi */
export function parsePushData(data: unknown): PushData | null {
  if (data == null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type === PUSH_TYPE_ANNOUNCEMENT && isText(d.gymId) && isText(d.announcementId)) {
    return { type: PUSH_TYPE_ANNOUNCEMENT, gymId: d.gymId, announcementId: d.announcementId };
  }
  if (
    d.type === PUSH_TYPE_CLASS_CHANGE &&
    isText(d.gymId) &&
    isText(d.templateId) &&
    isText(d.date) &&
    DATE_RE.test(d.date)
  ) {
    return { type: PUSH_TYPE_CLASS_CHANGE, gymId: d.gymId, templateId: d.templateId, date: d.date };
  }
  if ((d.type === PUSH_TYPE_TRAINER_REQUEST || d.type === PUSH_TYPE_TRAINER_ACCEPTED) && isText(d.gymId) && isText(d.linkId)) {
    return { type: d.type, gymId: d.gymId, linkId: d.linkId };
  }
  return null;
}

export type PushTarget =
  | { pathname: '/announcements' }
  | { pathname: '/classes'; params: { date: string; focus: string; gymId: string } }
  | { pathname: '/trainer/consent'; params: { id: string } }
  | { pathname: '/trainer/students'; params: { gymId: string } };

/**
 * Dokununca: duyuru → duyurular ekranı (açılınca yenilenir); ders →
 * program ekranında o gün ve o ders (ders hatırlatmasıyla aynı). Hoca
 * isteği → öğrencinin izin ekranı; kabul → hocanın öğrenci listesi (v3.6a).
 */
export function pushTarget(data: unknown): PushTarget | null {
  const d = parsePushData(data);
  if (!d) return null;
  if (d.type === PUSH_TYPE_ANNOUNCEMENT) return { pathname: '/announcements' };
  if (d.type === PUSH_TYPE_TRAINER_REQUEST) return { pathname: '/trainer/consent', params: { id: d.linkId } };
  if (d.type === PUSH_TYPE_TRAINER_ACCEPTED) return { pathname: '/trainer/students', params: { gymId: d.gymId } };
  return { pathname: '/classes', params: { date: d.date, focus: `${d.templateId}:${d.date}`, gymId: d.gymId } };
}

// ============================================================================
// İzin (salona ilk katılışta, açıklamayla)
// ============================================================================

/**
 * Salona katılınca açıklama gösterilsin mi: izin yok ve daha önce hiç
 * sorulmadı (dinlenme bildirimiyle aynı "soruldu" bayrağı; reddedene bir
 * daha sorulmaz).
 */
export function shouldExplainPushPermission(granted: boolean, asked: boolean): boolean {
  return !granted && !asked;
}

export const PUSH_PERMISSION_TEXT = {
  title: 'Bildirimlere izin verelim mi?',
  body: 'Salonundan yeni duyuru geldiğinde ve katılacağın ders iptal edildiğinde ya da değiştiğinde haber verelim. Ayarlar → Antrenman tercihleri’nden kapatabilirsin.',
  later: 'Şimdi değil',
  allow: 'İzin ver',
} as const;

// ============================================================================
// Token kaydı
// ============================================================================

export const PUSH_REGISTRATION_KEY = 'push.registration';
/** Aynı token'ı en fazla bu sıklıkla tazele (sunucuda last_seen_at) */
export const PUSH_REFRESH_MS = 24 * 60 * 60 * 1000;

export type PushPlatform = 'android' | 'ios';

export interface StoredRegistration {
  userId: string;
  token: string;
  at: number;
}

export function parseRegistration(raw: string | null): StoredRegistration | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredRegistration>;
    return isText(v.userId) && isText(v.token) && typeof v.at === 'number' ? (v as StoredRegistration) : null;
  } catch {
    return null;
  }
}

/** Telefondaki kayıt bu kullanıcı için taze mi (sunucuya gitmeye gerek yok) */
export function isRegistrationFresh(stored: StoredRegistration | null, userId: string, nowMs: number): boolean {
  return stored != null && stored.userId === userId && nowMs - stored.at < PUSH_REFRESH_MS && nowMs >= stored.at;
}

export interface PushDeviceApi {
  platform: PushPlatform;
  /** İzin verilmiş mi (sormadan) */
  isGranted(): Promise<boolean>;
  /** Android kanalları (token'dan önce; bildirim gelince kanal hazır olsun) */
  ensureChannels(): Promise<void>;
  /** Expo push token'ı ("ExponentPushToken[…]") */
  getToken(): Promise<string>;
}

export type RegisterResult = 'registered' | 'fresh' | 'no-permission' | 'failed';

export function registerPushToken(client: SupabaseClient, token: string, platform: PushPlatform) {
  return client.rpc('register_push_token', { p_token: token, p_platform: platform });
}

export function deletePushToken(client: SupabaseClient, token: string) {
  return client.from('push_tokens').delete().eq('token', token);
}

/**
 * Kayıt akışı. Çağrılar sıraya girer. Fırlatmaz: hata `onError`'a gider,
 * sonuç 'failed'.
 */
export function createPushRegistrar(
  api: PushDeviceApi,
  store: RemovableKeyValueStore,
  deps: { now?: () => number; onError?: (err: unknown) => void } = {}
) {
  const now = deps.now ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    const next = queue.then(fn).catch((err) => {
      deps.onError?.(err);
      return fallback;
    });
    queue = next;
    return next;
  };

  return {
    /**
     * İzin varsa token'ı alıp kaydeder. `force`: token değişti (Expo
     * dinleyicisi) ya da izin yeni verildi; tazelik denetimi atlanır.
     */
    register(client: SupabaseClient | null, userId: string, options: { force?: boolean } = {}): Promise<RegisterResult> {
      return enqueue<RegisterResult>(async () => {
        if (!client) return 'failed';
        if (!(await api.isGranted())) return 'no-permission';
        const stored = parseRegistration(await store.getItem(PUSH_REGISTRATION_KEY));
        if (!options.force && isRegistrationFresh(stored, userId, now())) return 'fresh';
        await api.ensureChannels();
        const token = await api.getToken();
        const { error } = await registerPushToken(client, token, api.platform);
        if (error) throw error;
        const record: StoredRegistration = { userId, token, at: now() };
        await store.setItem(PUSH_REGISTRATION_KEY, JSON.stringify(record));
        return 'registered';
      }, 'failed');
    },

    /**
     * Çıkıştan ÖNCE (oturum varken): sunucudaki satırı siler, telefondaki
     * kaydı unutur. Sunucu silinemese de telefondaki kayıt silinir; sonraki
     * girişte yeniden kaydedilir.
     */
    unregister(client: SupabaseClient | null): Promise<void> {
      return enqueue<void>(async () => {
        const stored = parseRegistration(await store.getItem(PUSH_REGISTRATION_KEY));
        await store.removeItem(PUSH_REGISTRATION_KEY);
        if (!stored || !client) return;
        const { error } = await deletePushToken(client, stored.token);
        if (error) throw error;
      }, undefined);
    },

    /** Hesap silindi (sunucuda cascade): yalnızca telefondaki kayıt */
    forget(): Promise<void> {
      return enqueue<void>(() => store.removeItem(PUSH_REGISTRATION_KEY), undefined);
    },
  };
}

// ============================================================================
// Bildirim tercihleri (sunucuda; satır yoksa hepsi açık)
// ============================================================================

export interface NotificationPrefs {
  announcements: boolean;
  classChanges: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { announcements: true, classChanges: true };

export function parsePrefsRow(row: unknown): NotificationPrefs {
  if (row == null || typeof row !== 'object') return { ...DEFAULT_NOTIFICATION_PREFS };
  const r = row as Record<string, unknown>;
  return {
    announcements: typeof r.notify_announcements === 'boolean' ? r.notify_announcements : true,
    classChanges: typeof r.notify_class_changes === 'boolean' ? r.notify_class_changes : true,
  };
}

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return { ok: false, error: accountError('not_configured') };
  try {
    return await fn(client);
  } catch (e) {
    console.error('[PUSH] HATA:', e);
    return { ok: false, error: toAccountError(e) };
  }
}

export function fetchNotificationPrefs(client: SupabaseClient | null, userId: string) {
  return run<NotificationPrefs>(client, async (c) => {
    const { data, error } = await c
      .from('notification_prefs')
      .select('notify_announcements, notify_class_changes')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return { ok: false, error: toAccountError(error) };
    return { ok: true, value: parsePrefsRow(data) };
  });
}

export function saveNotificationPrefs(client: SupabaseClient | null, userId: string, prefs: NotificationPrefs) {
  return run<NotificationPrefs>(client, async (c) => {
    const { data, error } = await c
      .from('notification_prefs')
      .upsert(
        { user_id: userId, notify_announcements: prefs.announcements, notify_class_changes: prefs.classChanges },
        { onConflict: 'user_id' }
      )
      .select('notify_announcements, notify_class_changes')
      .single();
    if (error) return { ok: false, error: toAccountError(error) };
    return { ok: true, value: parsePrefsRow(data) };
  });
}
