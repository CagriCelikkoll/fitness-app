/**
 * Derse katılım (v3.2c BÖLÜM 5) — basit, cezasız. Saf mantık + Supabase.
 * Sunucu: supabase/migrations/0006_class_rsvps.sql (yetkiyi sunucu
 * belirler; buradaki kontroller yalnızca görünüm için).
 *
 * - "Katılıyorum" zorunlu değil; ceza, gelmeme sayacı, yoklama yok.
 * - Kapasite yumuşak: dolunca düğme pasif ve "yine de gelebilirsin"
 *   notu; sunucu engellemiyor.
 * - Üye yalnızca kişi sayısını görür; hoca / yönetici adları.
 *
 * React ve Expo bilmez; test/classRsvps.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult, GymMembership } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';
import type { KeyValueStore } from '@/lib/announcements';
import { addDays, gymNow, parseTime, type ClassOccurrence } from '@/lib/classes';

export interface ClassRsvp {
  templateId: string;
  date: string;
  userId: string;
}

/** Ders oturumu anahtarı (ClassOccurrence.key ile aynı) */
export const sessionKey = (templateId: string, date: string) => `${templateId}:${date}`;

export interface Attendance {
  /** Benim katıldığım oturumlar */
  mine: string[];
  /** Oturum → kişi sayısı (herkes görür) */
  counts: Record<string, number>;
  /** Oturum → katılan kullanıcılar (yalnızca hoca / yönetici; üyede boş) */
  attendees: Record<string, string[]>;
  /** Kullanıcı → görünen ad (yalnızca hoca / yönetici) */
  names: Record<string, string | null>;
}

export const EMPTY_ATTENDANCE: Attendance = { mine: [], counts: {}, attendees: {}, names: {} };

// ============================================================================
// Saf mantık
// ============================================================================

/** Ders başladı mı (salon saatiyle, değiştiyse yeni saat) */
export function hasStarted(o: Pick<ClassOccurrence, 'date' | 'startTime'>, nowMs: number): boolean {
  const now = gymNow(nowMs);
  if (o.date !== now.date) return o.date < now.date;
  return (parseTime(o.startTime) ?? 0) <= now.minutes;
}

export interface AttendanceView {
  /** "8 kişi katılıyor", "8 / 20", "Henüz katılan yok" */
  countText: string;
  joined: boolean;
  /** Düğme gösterilsin mi (iptal / başlamış derste yok) */
  showButton: boolean;
  /** Katılmamış ve kapasite dolu: düğme pasif */
  full: boolean;
  fullMessage: string | null;
}

export const FULL_MESSAGE = 'Ders dolu görünüyor. Yine de gelebilirsin; yer durumunu hocana sor.';

export function attendanceView(
  o: Pick<ClassOccurrence, 'key' | 'date' | 'startTime' | 'status' | 'capacity'>,
  attendance: Pick<Attendance, 'mine' | 'counts'>,
  nowMs: number
): AttendanceView {
  const count = attendance.counts[o.key] ?? 0;
  const joined = attendance.mine.includes(o.key);
  const countText =
    o.capacity != null ? `${count} / ${o.capacity}` : count > 0 ? `${count} kişi katılıyor` : 'Henüz katılan yok';
  const showButton = o.status !== 'cancelled' && !hasStarted(o, nowMs);
  const full = showButton && !joined && o.capacity != null && count >= o.capacity;
  return { countText, joined, showButton, full, fullMessage: full ? FULL_MESSAGE : null };
}

/** Katıl / vazgeç sonrası yerel durum (sunucu yanıtı beklenmeden) */
export function applyRsvp(attendance: Attendance, key: string, userId: string, joined: boolean): Attendance {
  const isMine = attendance.mine.includes(key);
  if (isMine === joined) return attendance;
  const count = Math.max(0, (attendance.counts[key] ?? 0) + (joined ? 1 : -1));
  const list = attendance.attendees[key];
  return {
    ...attendance,
    mine: joined ? [...attendance.mine, key] : attendance.mine.filter((k) => k !== key),
    counts: { ...attendance.counts, [key]: count },
    attendees:
      list == null
        ? attendance.attendees
        : { ...attendance.attendees, [key]: joined ? [...list, userId] : list.filter((u) => u !== userId) },
  };
}

/** Adları görebilir mi (görünüm; yetkiyi RLS belirler) */
export function canSeeAttendees(gymId: string, memberships: readonly Pick<GymMembership, 'gymId' | 'role'>[]): boolean {
  return memberships.some((m) => m.gymId === gymId && (m.role === 'trainer' || m.role === 'admin'));
}

export const UNNAMED = 'Adı girilmemiş üye';

/** "Ali, Ayşe ve 2 adı girilmemiş üye" */
export function attendeeNames(userIds: readonly string[], names: Record<string, string | null>): string {
  const named = userIds
    .map((u) => names[u]?.trim())
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b, 'tr'));
  const unnamed = userIds.length - named.length;
  if (unnamed === 0) return named.join(', ');
  const rest = unnamed === 1 && named.length === 0 ? UNNAMED : `${unnamed} adı girilmemiş üye`;
  return named.length === 0 ? rest : `${named.join(', ')} ve ${rest}`;
}

// ============================================================================
// Satırlar
// ============================================================================

const isStr = (v: unknown): v is string => typeof v === 'string';

export function parseRsvpRows(data: unknown): ClassRsvp[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((raw) => raw as Record<string, unknown>)
    .filter((r) => isStr(r?.template_id) && isStr(r.date) && isStr(r.user_id))
    .map((r) => ({ templateId: r.template_id as string, date: r.date as string, userId: r.user_id as string }));
}

export function parseCountRows(data: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(data)) return out;
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    const count = Number(r?.count);
    if (isStr(r?.template_id) && isStr(r.date) && Number.isFinite(count)) out[sessionKey(r.template_id, r.date)] = count;
  }
  return out;
}

/** Sunucudan gelenleri tek yapıya çevirir */
export function buildAttendance(
  userId: string,
  rsvps: readonly ClassRsvp[],
  counts: Record<string, number>,
  names: Record<string, string | null>
): Attendance {
  const mine: string[] = [];
  const attendees: Record<string, string[]> = {};
  for (const r of rsvps) {
    const key = sessionKey(r.templateId, r.date);
    if (r.userId === userId) mine.push(key);
    (attendees[key] ??= []).push(r.userId);
  }
  return { mine, counts, attendees, names };
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
    console.error('[CLASS-RSVP] HATA:', e);
    return err(e);
  }
}

/** Katılım penceresi: geçmiş 4 hafta, gelecek 8 hafta */
export const ATTENDANCE_PAST_DAYS = 28;
export const ATTENDANCE_FUTURE_DAYS = 56;

/**
 * Sayılar (herkes), görünen katılımlar (RLS: üyeye yalnızca kendisininki,
 * hoca / yöneticiye salonundakiler) ve adlar (profiles; RLS aynı kural).
 */
export function fetchAttendance(client: SupabaseClient | null, userId: string, nowMs: number = Date.now()) {
  return run<Attendance>(client, async (c) => {
    const today = gymNow(nowMs).date;
    const from = addDays(today, -ATTENDANCE_PAST_DAYS);
    const to = addDays(today, ATTENDANCE_FUTURE_DAYS);
    const [rows, counts] = await Promise.all([
      c.from('class_rsvps').select('template_id, date, user_id').gte('date', from).lte('date', to).limit(5000),
      c.rpc('class_rsvp_counts', { p_from: from, p_to: to }),
    ]);
    if (rows.error) return err(rows.error);
    if (counts.error) return err(counts.error);
    const rsvps = parseRsvpRows(rows.data);
    const others = [...new Set(rsvps.map((r) => r.userId).filter((u) => u !== userId))];
    const names: Record<string, string | null> = {};
    if (others.length > 0) {
      const profiles = await c.from('profiles').select('id, display_name').in('id', others);
      if (profiles.error) return err(profiles.error);
      for (const p of (profiles.data ?? []) as { id: string; display_name: string | null }[]) {
        names[p.id] = p.display_name;
      }
    }
    return ok(buildAttendance(userId, rsvps, parseCountRows(counts.data), names));
  });
}

export function joinClass(client: SupabaseClient | null, o: Pick<ClassOccurrence, 'templateId' | 'date'>) {
  return run<null>(client, async (c) => {
    const { error } = await c.from('class_rsvps').insert({ template_id: o.templateId, date: o.date });
    // Zaten katılıyorsa (başka telefondan) sonuç aynı
    if (error && error.code !== '23505') return err(error);
    return ok(null);
  });
}

/** Ders başladıysa RLS silmez → "ders başladı" */
export function leaveClass(client: SupabaseClient | null, o: Pick<ClassOccurrence, 'templateId' | 'date'>, userId: string) {
  return run<null>(client, async (c) => {
    const { data, error } = await c
      .from('class_rsvps')
      .delete()
      .eq('template_id', o.templateId)
      .eq('date', o.date)
      .eq('user_id', userId)
      .select('template_id');
    if (error) return err(error);
    if (Array.isArray(data) && data.length > 0) return ok(null);
    // Satır yoksa: zaten vazgeçilmiş ya da ders başlamış
    const { data: still } = await c
      .from('class_rsvps')
      .select('template_id')
      .eq('template_id', o.templateId)
      .eq('date', o.date)
      .eq('user_id', userId);
    return Array.isArray(still) && still.length > 0 ? { ok: false, error: accountError('class_started') } : ok(null);
  });
}

// ============================================================================
// Önbellek (kv-store, kullanıcıya göre; çevrimdışı görünüm)
// ============================================================================

export const attendanceCacheKey = (userId: string) => `classes.attendance.${userId}`;

export async function readAttendanceCache(store: KeyValueStore, userId: string): Promise<Attendance | null> {
  try {
    const raw = await store.getItem(attendanceCacheKey(userId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Attendance>;
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);
    const record = <T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> => {
      const out: Record<string, T> = {};
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k, x] of Object.entries(v)) if (ok(x)) out[k] = x;
      }
      return out;
    };
    return {
      mine: strings(p.mine),
      counts: record(p.counts, (x): x is number => typeof x === 'number' && Number.isFinite(x)),
      attendees: Object.fromEntries(
        Object.entries(record(p.attendees, Array.isArray)).map(([k, v]) => [k, strings(v)])
      ),
      names: record(p.names, (x): x is string | null => x === null || isStr(x)),
    };
  } catch {
    return null;
  }
}

export async function writeAttendanceCache(store: KeyValueStore, userId: string, a: Attendance): Promise<void> {
  await store.setItem(attendanceCacheKey(userId), JSON.stringify(a));
}
