/**
 * Salon geri bildirimi (v3.6d) — saf mantık + Supabase.
 * Sunucu: supabase/migrations/0013_feedback.sql. Kuralları (yetki,
 * anonimlik, günlük sınır, durum geçişleri) sunucu uyguluyor; buradaki
 * kontroller form ve görünüm için.
 *
 * - Üye kendi kayıtlarını tablodan okur; yönetici `feedback_list()` ile
 *   okur ve anonim kayıtlarda yazar kimliği gelmez.
 * - Fotoğraf özel `gym-feedback` bucket'ında, `<salon>/<rastgele>.jpg`;
 *   göstermek için süreli imzalı adres.
 *
 * Fonksiyonlar fırlatmaz; React ve Expo bilmez; test/feedback.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';
import { gymNow } from '@/lib/classes';

export const FEEDBACK_BUCKET = 'gym-feedback';
export const FEEDBACK_BODY_MIN = 5;
export const FEEDBACK_BODY_MAX = 1000;
export const FEEDBACK_REPLY_MAX = 1000;
export const FEEDBACK_DAILY_LIMIT = 5;
/** Fotoğrafın uzun kenarı (px) */
export const FEEDBACK_PHOTO_SIZE = 1024;
/** Bucket sınırıyla aynı */
export const FEEDBACK_PHOTO_MAX_BYTES = 1024 * 1024;
/** İmzalı fotoğraf adresinin ömrü (sn) */
export const FEEDBACK_PHOTO_URL_TTL = 3600;

export type FeedbackCategory = 'equipment' | 'cleanliness' | 'classes' | 'staff' | 'other';
export type FeedbackStatus = 'new' | 'in_progress' | 'resolved';

export const FEEDBACK_CATEGORIES: { key: FeedbackCategory; label: string }[] = [
  { key: 'equipment', label: 'Ekipman' },
  { key: 'cleanliness', label: 'Temizlik' },
  { key: 'classes', label: 'Dersler' },
  { key: 'staff', label: 'Personel' },
  { key: 'other', label: 'Diğer' },
];

export const FEEDBACK_STATUSES: { key: FeedbackStatus; label: string }[] = [
  { key: 'new', label: 'Yeni' },
  { key: 'in_progress', label: 'İnceleniyor' },
  { key: 'resolved', label: 'Çözüldü' },
];

export function categoryLabel(c: FeedbackCategory): string {
  return FEEDBACK_CATEGORIES.find((x) => x.key === c)?.label ?? 'Diğer';
}

export function statusLabel(s: FeedbackStatus): string {
  return FEEDBACK_STATUSES.find((x) => x.key === s)?.label ?? 'Yeni';
}

/** Sunucudaki feedback_status_allowed ile aynı (aynı durum her zaman geçerli) */
export const STATUS_NEXT: Record<FeedbackStatus, FeedbackStatus[]> = {
  new: ['in_progress', 'resolved'],
  in_progress: ['new', 'resolved'],
  resolved: ['in_progress'],
};

export function canSetStatus(from: FeedbackStatus, to: FeedbackStatus): boolean {
  return from === to || STATUS_NEXT[from].includes(to);
}

export interface Feedback {
  id: string;
  gymId: string;
  category: FeedbackCategory;
  body: string;
  photoPath: string | null;
  anonymous: boolean;
  /** Yöneticide anonim kayıtta her zaman null */
  authorId: string | null;
  authorName: string | null;
  status: FeedbackStatus;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

const CATEGORY_KEYS = FEEDBACK_CATEGORIES.map((c) => c.key) as string[];
const STATUS_KEYS = FEEDBACK_STATUSES.map((s) => s.key) as string[];
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

export function parseFeedbackRows(rows: unknown): Feedback[] {
  if (!Array.isArray(rows)) return [];
  const out: Feedback[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (
      typeof r?.id !== 'string' ||
      typeof r.gym_id !== 'string' ||
      typeof r.body !== 'string' ||
      typeof r.created_at !== 'string' ||
      !CATEGORY_KEYS.includes(r.category as string) ||
      !STATUS_KEYS.includes(r.status as string)
    ) {
      continue;
    }
    out.push({
      id: r.id,
      gymId: r.gym_id,
      category: r.category as FeedbackCategory,
      body: r.body,
      photoPath: text(r.photo_path),
      anonymous: r.anonymous === true,
      authorId: r.anonymous === true ? null : text(r.author_id),
      authorName: r.anonymous === true ? null : text(r.author_name),
      status: r.status as FeedbackStatus,
      reply: text(r.reply),
      repliedAt: text(r.replied_at),
      createdAt: r.created_at,
    });
  }
  return out;
}

// ============================================================================
// Form
// ============================================================================

export interface FeedbackDraft {
  category: FeedbackCategory | null;
  body: string;
}

/** Göndermeden önce: sorun yoksa null, varsa gösterilecek metin */
export function validateFeedback(d: FeedbackDraft): string | null {
  if (!d.category) return 'Bir kategori seç.';
  const len = d.body.trim().length;
  if (len < FEEDBACK_BODY_MIN) return `En az ${FEEDBACK_BODY_MIN} karakter yaz.`;
  if (len > FEEDBACK_BODY_MAX) return `En fazla ${FEEDBACK_BODY_MAX} karakter yazabilirsin.`;
  return null;
}

/** Sayaç: "12 / 1000" */
export function counterText(body: string, max = FEEDBACK_BODY_MAX): string {
  return `${body.trim().length} / ${max}`;
}

/** Yazar satırı (yönetici): ad, "Anonim üye" ya da silinmiş / adsız */
export function authorLabel(f: Pick<Feedback, 'anonymous' | 'authorId' | 'authorName'>): string {
  if (f.anonymous) return 'Anonim üye';
  if (f.authorName) return f.authorName;
  return f.authorId ? 'Adı girilmemiş üye' : 'Hesabı silinmiş üye';
}

/** Listede metnin başı (tek satır, kelime sınırında) */
export function excerpt(body: string, max = 80): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  if ([...clean].length <= max) return clean;
  const cut = [...clean].slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ============================================================================
// Yönetici: filtre ve özet
// ============================================================================

export function filterFeedback(
  list: readonly Feedback[],
  filter: { status: FeedbackStatus | null; category: FeedbackCategory | null }
): Feedback[] {
  return list
    .filter((f) => (filter.status == null || f.status === filter.status) && (filter.category == null || f.category === filter.category))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface FeedbackSummary {
  /** Bu ay (salon takvimi) gelen */
  month: number;
  /** Bu ay gelenlerden çözülen */
  resolved: number;
  /** Şu an "Yeni" durumunda olan (ay fark etmeksizin) */
  fresh: number;
}

export function feedbackSummary(list: readonly Pick<Feedback, 'createdAt' | 'status'>[], nowMs: number): FeedbackSummary {
  const month = gymNow(nowMs).date.slice(0, 7);
  const inMonth = list.filter((f) => gymNow(Date.parse(f.createdAt)).date.startsWith(month));
  return {
    month: inMonth.length,
    resolved: inMonth.filter((f) => f.status === 'resolved').length,
    fresh: list.filter((f) => f.status === 'new').length,
  };
}

/** "Bu ay 14 geri bildirim · 9 çözüldü · 3 yeni" */
export function summaryText(s: FeedbackSummary): string {
  return `Bu ay ${s.month} geri bildirim · ${s.resolved} çözüldü · ${s.fresh} yeni`;
}

// ============================================================================
// Fotoğraf
// ============================================================================

/** Uzun kenar en fazla `max` px olacak boyut (büyütmez) */
export function fitWithin(width: number, height: number, max = FEEDBACK_PHOTO_SIZE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: max, height: max };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function photoObjectPath(gymId: string, fileId: string): string {
  return `${gymId}/${fileId.replace(/[^A-Za-z0-9_-]/g, '')}.jpg`;
}

// ============================================================================
// Supabase
// ============================================================================

const ok = <T>(value: T): AccountResult<T> => ({ ok: true, value });
const err = <T>(e: unknown): AccountResult<T> => ({ ok: false, error: toAccountError(e) });

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return { ok: false, error: accountError('not_configured') };
  try {
    return await fn(client);
  } catch (e) {
    console.error('[FEEDBACK] HATA:', e);
    return err(e);
  }
}

export interface FeedbackInput {
  gymId: string;
  category: FeedbackCategory;
  body: string;
  anonymous: boolean;
  /** JPEG baytları (küçültülmüş) ve dosya kimliği */
  photo: { bytes: ArrayBuffer | Uint8Array; fileId: string } | null;
}

/**
 * Fotoğraf varsa önce yüklenir, sonra kayıt. Kayıt olmazsa yüklenen dosya
 * geri silinir. Değer: yeni kaydın kimliği.
 */
export function submitFeedback(client: SupabaseClient | null, input: FeedbackInput) {
  return run<string>(client, async (c) => {
    let photoPath: string | null = null;
    if (input.photo) {
      if (input.photo.bytes.byteLength > FEEDBACK_PHOTO_MAX_BYTES) return { ok: false, error: accountError('invalid_input') };
      photoPath = photoObjectPath(input.gymId, input.photo.fileId);
      const { error } = await c.storage.from(FEEDBACK_BUCKET).upload(photoPath, input.photo.bytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (error) return err(error);
    }
    const { data, error } = await c.rpc('submit_feedback', {
      p_gym_id: input.gymId,
      p_category: input.category,
      p_body: input.body.trim(),
      p_anonymous: input.anonymous,
      p_photo_path: photoPath,
    });
    if (error) {
      if (photoPath) await c.storage.from(FEEDBACK_BUCKET).remove([photoPath]);
      return err(error);
    }
    return ok(String(data));
  });
}

/** Üye: kendi gönderdiklerim (tablo, RLS yalnızca yazar) */
export function fetchMyFeedback(client: SupabaseClient | null, gymId: string | null = null) {
  return run<Feedback[]>(client, async (c) => {
    let q = c
      .from('gym_feedback')
      .select('id, gym_id, category, body, photo_path, anonymous, author_id, status, reply, replied_at, created_at');
    if (gymId) q = q.eq('gym_id', gymId);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
    if (error) return err(error);
    return ok(parseFeedbackRows(data));
  });
}

/** Yönetici: salonun bütün geri bildirimleri (anonimlerde yazar yok) */
export function fetchGymFeedback(client: SupabaseClient | null, gymId: string) {
  return run<Feedback[]>(client, async (c) => {
    const { data, error } = await c.rpc('feedback_list', { p_gym_id: gymId });
    if (error) return err(error);
    return ok(parseFeedbackRows(data));
  });
}

export function answerFeedback(client: SupabaseClient | null, id: string, status: FeedbackStatus, reply: string) {
  return run<null>(client, async (c) => {
    const { error } = await c.rpc('answer_feedback', { p_id: id, p_status: status, p_reply: reply });
    return error ? err(error) : ok(null);
  });
}

/** Önce fotoğraf (Storage API), sonra kayıt */
export function deleteFeedback(client: SupabaseClient | null, f: Pick<Feedback, 'id' | 'photoPath'>) {
  return run<null>(client, async (c) => {
    if (f.photoPath) {
      const { error } = await c.storage.from(FEEDBACK_BUCKET).remove([f.photoPath]);
      if (error) console.warn('[FEEDBACK] Fotoğraf silinemedi:', error.message);
    }
    const { error } = await c.rpc('delete_feedback', { p_id: f.id });
    return error ? err(error) : ok(null);
  });
}

/** Fotoğrafların süreli adresleri (yol → adres); okunamayan yok */
export function photoUrls(client: SupabaseClient | null, paths: readonly string[]) {
  return run<Record<string, string>>(client, async (c) => {
    const unique = [...new Set(paths)];
    if (unique.length === 0) return ok({});
    const { data, error } = await c.storage.from(FEEDBACK_BUCKET).createSignedUrls(unique, FEEDBACK_PHOTO_URL_TTL);
    if (error) return err(error);
    const out: Record<string, string> = {};
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error) out[item.path] = item.signedUrl;
    }
    return ok(out);
  });
}
