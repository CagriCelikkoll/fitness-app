/**
 * Salon girişi ve devam (v3.6c) — saf mantık + Supabase.
 * Sunucu: supabase/migrations/0012_visits.sql. Kuralları sunucu
 * uyguluyor; buradaki hesaplar görünüm için.
 *
 * - Üye girişteki QR afişini okutur (`dinc://checkin?g=<salon>&k=<anahtar>`).
 *   Afiş telefonun kendi kamerasıyla okutulsa da uygulama aynı ekranla
 *   açılır (scheme `dinc`).
 * - "Salonda": çıkışsız ve son 3 saatte girmiş. Çıkışsız ziyaret 4 saatten
 *   eskiyse kapalı sayılır, süresi bilinmiyor: gün sayısına girer,
 *   ortalamaya girmez.
 * - Günler salon takvimiyle (Europe/Istanbul = sabit UTC+3, `gymNow`).
 *
 * Fonksiyonlar fırlatmaz; React ve Expo bilmez; test/visits.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';
import type { KeyValueStore } from '@/lib/announcements';
import { addDays, gymNow, weekdayOf } from '@/lib/classes';
import { formatEndDate } from '@/lib/gymAdmin';

/** "Salonda" sayılma ve 3 saatte ikinci okutmanın yeni ziyaret açmaması */
export const INSIDE_HOURS = 3;
/** Çıkışsız ziyaret bu kadar eskiyse süresi bilinmiyor */
export const STALE_HOURS = 4;
/** Hoca listesinde uyarı: bu kadar gündür gelmeyen öğrenci */
export const INACTIVE_DAYS = 10;
export const HEATMAP_WEEKS = 8;

const HOUR = 3_600_000;
const MINUTE = 60_000;

export type VisitSource = 'qr' | 'manual' | 'turnstile' | 'import';

export interface Visit {
  id: string;
  gymId: string;
  userId: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  source: VisitSource;
  workoutClientId: string | null;
}

const SOURCES: readonly VisitSource[] = ['qr', 'manual', 'turnstile', 'import'];
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function parseVisitRows(rows: unknown): Visit[] {
  if (!Array.isArray(rows)) return [];
  const out: Visit[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (
      typeof r?.id !== 'string' ||
      typeof r.gym_id !== 'string' ||
      typeof r.user_id !== 'string' ||
      typeof r.checked_in_at !== 'string' ||
      Number.isNaN(Date.parse(r.checked_in_at))
    ) {
      continue;
    }
    out.push({
      id: r.id,
      gymId: r.gym_id,
      userId: r.user_id,
      checkedInAt: r.checked_in_at,
      checkedOutAt: text(r.checked_out_at),
      source: SOURCES.includes(r.source as VisitSource) ? (r.source as VisitSource) : 'qr',
      workoutClientId: text(r.workout_client_id),
    });
  }
  return out;
}

// ============================================================================
// QR
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Afişteki içerik. Uygulamanın scheme'i: sistem kamerasıyla okutulsa da Dinç açılır. */
export function buildCheckinQr(gymId: string, secret: string): string {
  return `dinc://checkin?g=${gymId}&k=${secret}`;
}

/** QR içeriği → salon ve anahtar; bizim afişimiz değilse null */
export function parseCheckinQr(data: string | null | undefined): { gymId: string; secret: string } | null {
  if (!data) return null;
  const m = /^dinc:\/\/\/?checkin\/?\?(.+)$/i.exec(data.trim());
  if (!m) return null;
  const params = new Map<string, string>();
  for (const part of m[1].split('&')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      params.set(part.slice(0, i), decodeURIComponent(part.slice(i + 1)));
    } catch {
      return null;
    }
  }
  return checkinParams(params.get('g'), params.get('k'));
}

/** Derin bağlantı / rota parametreleri → salon ve anahtar */
export function checkinParams(g: unknown, k: unknown): { gymId: string; secret: string } | null {
  if (typeof g !== 'string' || typeof k !== 'string') return null;
  if (!UUID_RE.test(g) || !SECRET_RE.test(k)) return null;
  return { gymId: g.toLowerCase(), secret: k };
}

export type QrProblem = 'not_ours' | 'other_gym';

/** Okutulan QR'da sorun: Dinç afişi değil ya da üyesi olmadığım bir salonun */
export function qrProblem(parsed: { gymId: string } | null, memberGymIds: readonly string[]): QrProblem | null {
  if (!parsed) return 'not_ours';
  if (!memberGymIds.some((id) => id.toLowerCase() === parsed.gymId)) return 'other_gym';
  return null;
}

export function qrProblemText(problem: QrProblem): string {
  return problem === 'other_gym' ? 'Bu QR başka bir salona ait.' : 'Bu bir Dinç salon girişi QR kodu değil.';
}

// ============================================================================
// Süre ve durum
// ============================================================================

export type VisitState =
  | { kind: 'inside'; minutes: number }
  /** Çıkışsız, 3–4 saat arası: salonda sayılmaz, süresi henüz belli değil */
  | { kind: 'pending' }
  | { kind: 'closed'; minutes: number }
  | { kind: 'unknown' };

export function visitState(v: Pick<Visit, 'checkedInAt' | 'checkedOutAt'>, nowMs: number): VisitState {
  const inMs = Date.parse(v.checkedInAt);
  if (v.checkedOutAt) {
    return { kind: 'closed', minutes: Math.max(0, Math.round((Date.parse(v.checkedOutAt) - inMs) / MINUTE)) };
  }
  const age = nowMs - inMs;
  if (age < INSIDE_HOURS * HOUR) return { kind: 'inside', minutes: Math.max(0, Math.floor(age / MINUTE)) };
  if (age < STALE_HOURS * HOUR) return { kind: 'pending' };
  return { kind: 'unknown' };
}

/** Şu an salondaysam o ziyaret (en yenisi) */
export function currentVisit(visits: readonly Visit[], userId: string | null, gymId: string, nowMs: number): Visit | null {
  if (!userId) return null;
  return (
    visits
      .filter((v) => v.userId === userId && v.gymId === gymId && visitState(v, nowMs).kind === 'inside')
      .sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt))[0] ?? null
  );
}

/** 42 → "42 dk"; 60 → "1 sa"; 72 → "1 sa 12 dk" */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} sa` : `${h} sa ${rest} dk`;
}

export function insideText(minutes: number): string {
  return `Salondasın · ${formatMinutes(minutes)}`;
}

export function occupancyText(count: number | null): string | null {
  if (count == null) return null;
  return count === 0 ? 'Şu an salonda kimse yok' : `Şu an salonda ~${count} kişi`;
}

/**
 * Antrenman bitince ziyarete bağlanır mı (sunucu da aynı kuralı uyguluyor):
 * ziyaret açık ve antrenman giriş ile giriş + 4 saat arasında, gelecekte
 * değil (5 dk pay) bitti.
 */
export function shouldLinkWorkout(
  visit: Pick<Visit, 'checkedInAt' | 'checkedOutAt'>,
  endedAtMs: number,
  nowMs: number
): boolean {
  if (visit.checkedOutAt) return false;
  const inMs = Date.parse(visit.checkedInAt);
  return endedAtMs >= inMs && endedAtMs <= inMs + STALE_HOURS * HOUR && endedAtMs <= nowMs + 5 * MINUTE;
}

// ============================================================================
// Gün sayıları, ortalama, seri, ısı haritası (salon takvimi)
// ============================================================================

export function visitDayKey(iso: string): string {
  return gymNow(Date.parse(iso)).date;
}

/** Haftanın pazartesisi */
export function weekStart(dayKey: string): string {
  return addDays(dayKey, 1 - weekdayOf(dayKey));
}

function dayKeys(visits: readonly Pick<Visit, 'checkedInAt'>[]): Set<string> {
  return new Set(visits.map((v) => visitDayKey(v.checkedInAt)));
}

export interface MonthStats {
  /** Bu ay gelinen gün */
  days: number;
  /** Bu ayın süresi belli ziyaretlerinin ortalaması (dk); yoksa null */
  averageMinutes: number | null;
  /** Bu hafta gelinen gün */
  weekDays: number;
  /** Üst üste en az bir gün gelinen hafta sayısı (bu hafta henüz yoksa geçen haftadan) */
  streakWeeks: number;
}

export function averageMinutes(visits: readonly Visit[], nowMs: number): number | null {
  const durations: number[] = [];
  for (const v of visits) {
    const s = visitState(v, nowMs);
    if (s.kind === 'closed') durations.push(s.minutes);
  }
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}

export function monthStats(visits: readonly Visit[], nowMs: number): MonthStats {
  const today = gymNow(nowMs).date;
  const month = today.slice(0, 7);
  const inMonth = visits.filter((v) => visitDayKey(v.checkedInAt).startsWith(month));
  const days = dayKeys(visits);
  const thisWeek = weekStart(today);
  let weekDays = 0;
  for (const d of days) if (d >= thisWeek && d <= today) weekDays += 1;

  const weeks = new Set([...days].map(weekStart));
  let cursor = weeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let streakWeeks = 0;
  while (weeks.has(cursor)) {
    streakWeeks += 1;
    cursor = addDays(cursor, -7);
  }
  return { days: dayKeys(inMonth).size, averageMinutes: averageMinutes(inMonth, nowMs), weekDays, streakWeeks };
}

export interface HeatmapDay {
  date: string;
  count: number;
  future: boolean;
}

/** Son `weeks` hafta, pazartesiden başlayan sütunlar; eski hafta önce */
export function heatmap(visits: readonly Pick<Visit, 'checkedInAt'>[], nowMs: number, weeks = HEATMAP_WEEKS): HeatmapDay[][] {
  const today = gymNow(nowMs).date;
  const counts = new Map<string, number>();
  for (const v of visits) {
    const d = visitDayKey(v.checkedInAt);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const out: HeatmapDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatmapDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(first, w * 7 + d);
      col.push({ date, count: counts.get(date) ?? 0, future: date > today });
    }
    out.push(col);
  }
  return out;
}

/** Son gelişten bu yana gün (0 = bugün); hiç yoksa null */
export function daysSinceLastVisit(visits: readonly Pick<Visit, 'checkedInAt'>[], nowMs: number): number | null {
  if (visits.length === 0) return null;
  const last = [...dayKeys(visits)].sort().pop()!;
  const today = gymNow(nowMs).date;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000);
}

export function lastVisitText(days: number | null): string {
  if (days == null) return 'Henüz gelmedi';
  if (days <= 0) return 'Bugün geldi';
  if (days === 1) return 'Dün geldi';
  return `${days} gün önce geldi`;
}

export function isInactive(days: number | null): boolean {
  return days == null || days > INACTIVE_DAYS;
}

export interface StudentAttendance {
  daysSince: number | null;
  monthDays: number;
  averageMinutes: number | null;
  inactive: boolean;
}

export function studentAttendance(visits: readonly Visit[], nowMs: number): StudentAttendance {
  const daysSince = daysSinceLastVisit(visits, nowMs);
  const stats = monthStats(visits, nowMs);
  return { daysSince, monthDays: stats.days, averageMinutes: stats.averageMinutes, inactive: isInactive(daysSince) };
}

/** Öğrencilerim satırının devam metni: "2 gün önce geldi · bu ay 6 gün · ort. 1 sa 5 dk" */
export function attendanceText(a: StudentAttendance): string {
  const parts = [lastVisitText(a.daysSince), `bu ay ${a.monthDays} gün`];
  if (a.averageMinutes != null) parts.push(`ort. ${formatMinutes(a.averageMinutes)}`);
  return parts.join(' · ');
}

/** 10 günden uzun gelmeyenler üstte (en uzun önce), sonra ada göre */
export function sortByAttendance<T>(
  list: readonly T[],
  attendanceOf: (item: T) => StudentAttendance,
  nameOf: (item: T) => string | null
): T[] {
  return [...list].sort((a, b) => {
    const x = attendanceOf(a);
    const y = attendanceOf(b);
    if (x.inactive !== y.inactive) return x.inactive ? -1 : 1;
    if (x.inactive && y.inactive) {
      const dx = x.daysSince ?? Number.MAX_SAFE_INTEGER;
      const dy = y.daysSince ?? Number.MAX_SAFE_INTEGER;
      if (dx !== dy) return dy - dx;
    }
    return (nameOf(a) ?? '￿').localeCompare(nameOf(b) ?? '￿', 'tr');
  });
}

// ============================================================================
// Yönetici paneli
// ============================================================================

/** Şu an salonda olanlar, önce gelen önce */
export function insideNow(visits: readonly Visit[], nowMs: number): Visit[] {
  const latest = new Map<string, Visit>();
  for (const v of visits) {
    if (visitState(v, nowMs).kind !== 'inside') continue;
    const prev = latest.get(v.userId);
    if (!prev || prev.checkedInAt < v.checkedInAt) latest.set(v.userId, v);
  }
  return [...latest.values()].sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt));
}

/** Son `days` gün, her gün giriş yapan kişi sayısı; eski gün önce */
export function dailyCounts(visits: readonly Visit[], nowMs: number, days = 7): { date: string; count: number }[] {
  const today = gymNow(nowMs).date;
  const users = new Map<string, Set<string>>();
  for (const v of visits) {
    const d = visitDayKey(v.checkedInAt);
    if (!users.has(d)) users.set(d, new Set());
    users.get(d)!.add(v.userId);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - (days - 1));
    return { date, count: users.get(date)?.size ?? 0 };
  });
}

const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export function weekdayShort(dayKey: string): string {
  return WEEKDAY_SHORT[weekdayOf(dayKey) - 1];
}

/** Salon saatiyle "18:05" */
export function gymTime(iso: string): string {
  const m = gymNow(Date.parse(iso)).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Ziyaret listesi satırı: "18 Ekim Cmt" · "18:05" · "1 sa 12 dk" */
export function visitRowText(v: Visit, nowMs: number): { date: string; time: string; duration: string } {
  const day = visitDayKey(v.checkedInAt);
  const s = visitState(v, nowMs);
  const duration =
    s.kind === 'closed'
      ? formatMinutes(s.minutes)
      : s.kind === 'inside'
        ? 'Salonda'
        : 'Süre bilinmiyor';
  return { date: `${formatEndDate(day, nowMs)} ${weekdayShort(day)}`, time: gymTime(v.checkedInAt), duration };
}

/** Elle giriş: "YYYY-AA-GG" + "SS:DD" (salon saati) → ISO; geçersizse null */
export function gymLocalToIso(dateKey: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!t) return null;
  const h = Number(t[1]);
  const min = Number(t[2]);
  if (h > 23 || min > 59) return null;
  const [y, mo, d] = dateKey.split('-').map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, min) - 180 * MINUTE;
  if (gymNow(ms).date !== dateKey) return null;
  return new Date(ms).toISOString();
}

// ============================================================================
// Açık ziyaret kaydı (cihazda): antrenman bitince otomatik çıkış için
// ============================================================================

export interface OpenVisitRecord {
  visitId: string;
  gymId: string;
  checkedInAt: string;
}

export const openVisitKey = (userId: string) => `visits.open.${userId}`;

export async function readOpenVisit(store: KeyValueStore, userId: string): Promise<OpenVisitRecord | null> {
  try {
    const raw = await store.getItem(openVisitKey(userId));
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<OpenVisitRecord>;
    if (typeof r.visitId !== 'string' || typeof r.gymId !== 'string' || typeof r.checkedInAt !== 'string') return null;
    return { visitId: r.visitId, gymId: r.gymId, checkedInAt: r.checkedInAt };
  } catch {
    return null;
  }
}

export async function writeOpenVisit(store: KeyValueStore, userId: string, record: OpenVisitRecord | null): Promise<void> {
  // Silme yerine boş değer: KeyValueStore'da removeItem yok
  await store.setItem(openVisitKey(userId), record ? JSON.stringify(record) : '');
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
    console.error('[VISITS] HATA:', e);
    return err(e);
  }
}

const first = (data: unknown): Record<string, unknown> | null =>
  Array.isArray(data) && data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>) : null;

export function checkIn(client: SupabaseClient | null, gymId: string, secret: string) {
  return run<{ id: string; checkedInAt: string; reused: boolean }>(client, async (c) => {
    const { data, error } = await c.rpc('check_in', { p_gym_id: gymId, p_secret: secret });
    if (error) return err(error);
    const r = first(data);
    if (!r || typeof r.id !== 'string' || typeof r.checked_in_at !== 'string') return err(new Error('check_in yanıtı'));
    return ok({ id: r.id, checkedInAt: r.checked_in_at, reused: r.reused === true });
  });
}

/** Döner: çıkış yazıldı mı (zaten çıkılmış / süresi geçmişse false) */
export function checkOut(client: SupabaseClient | null, visitId: string) {
  return run<boolean>(client, async (c) => {
    const { data, error } = await c.rpc('check_out', { p_visit_id: visitId });
    return error ? err(error) : ok(data === true);
  });
}

export function linkWorkoutToVisit(client: SupabaseClient | null, visitId: string, workoutClientId: string, endedAt: string) {
  return run<boolean>(client, async (c) => {
    const { data, error } = await c.rpc('link_workout_to_visit', {
      p_visit_id: visitId,
      p_workout_client_id: workoutClientId,
      p_ended_at: endedAt,
    });
    return error ? err(error) : ok(data === true);
  });
}

export function fetchOccupancy(client: SupabaseClient | null, gymId: string) {
  return run<number>(client, async (c) => {
    const { data, error } = await c.rpc('gym_occupancy', { p_gym_id: gymId });
    if (error) return err(error);
    return ok(typeof data === 'number' ? data : 0);
  });
}

/**
 * Görebildiğim ziyaretler (RLS: üye kendininkini, hoca aktif öğrencilerini,
 * yönetici salondakileri). `userId` verilirse yalnızca o kişinin.
 */
export function fetchVisits(client: SupabaseClient | null, options: { gymId: string; sinceIso: string; userId?: string }) {
  return run<Visit[]>(client, async (c) => {
    let q = c
      .from('gym_visits')
      .select('id, gym_id, user_id, checked_in_at, checked_out_at, source, workout_client_id')
      .eq('gym_id', options.gymId)
      .gte('checked_in_at', options.sinceIso);
    if (options.userId) q = q.eq('user_id', options.userId);
    const { data, error } = await q.order('checked_in_at', { ascending: false }).limit(5000);
    if (error) return err(error);
    return ok(parseVisitRows(data));
  });
}

export function manualVisit(
  client: SupabaseClient | null,
  input: { gymId: string; userId: string; checkedInAt: string; checkedOutAt: string | null }
) {
  return run<string>(client, async (c) => {
    const { data, error } = await c.rpc('manual_visit', {
      p_gym_id: input.gymId,
      p_user_id: input.userId,
      p_checked_in_at: input.checkedInAt,
      p_checked_out_at: input.checkedOutAt,
    });
    return error ? err(error) : ok(String(data));
  });
}

function keyResult(data: unknown): AccountResult<{ secret: string; rotatedAt: string | null }> {
  const r = first(data);
  if (!r || typeof r.secret !== 'string') return err(new Error('anahtar yanıtı'));
  return ok({ secret: r.secret, rotatedAt: text(r.rotated_at) });
}

/** Yönetici: afişteki anahtar (yoksa sunucu oluşturur) */
export function fetchCheckinKey(client: SupabaseClient | null, gymId: string) {
  return run<{ secret: string; rotatedAt: string | null }>(client, async (c) => {
    const { data, error } = await c.rpc('checkin_key', { p_gym_id: gymId });
    return error ? err(error) : keyResult(data);
  });
}

export function rotateCheckinKey(client: SupabaseClient | null, gymId: string) {
  return run<{ secret: string; rotatedAt: string | null }>(client, async (c) => {
    const { data, error } = await c.rpc('rotate_checkin_key', { p_gym_id: gymId });
    return error ? err(error) : keyResult(data);
  });
}

/** Isı haritası ve ay hesabı için çekilecek başlangıç: 8 hafta öncesinin pazartesisi ya da ayın başı */
export function visitsSince(nowMs: number, weeks = HEATMAP_WEEKS): string {
  const today = gymNow(nowMs).date;
  const heat = addDays(weekStart(today), -7 * (weeks - 1));
  const month = `${today.slice(0, 7)}-01`;
  const from = heat < month ? heat : month;
  // Salon gece yarısı (UTC+3) → UTC
  return new Date(Date.parse(`${from}T00:00:00Z`) - 180 * MINUTE).toISOString();
}
