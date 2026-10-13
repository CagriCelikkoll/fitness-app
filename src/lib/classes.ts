/**
 * Grup ders programı (v3.2c, Aşama 1) — saf mantık + Supabase çağrıları.
 * Sunucu: supabase/migrations/0005_classes.sql (yetkiyi sunucu belirler;
 * buradaki rol kontrolleri yalnızca görünüm için).
 *
 * - Şablon: her hafta tekrarlayan ders (gün + salonun yerel saati).
 * - İstisna: tek bir tarihte iptal ya da değişiklik (saat, hoca, not).
 * - Bir haftanın dersleri = etkin şablonlar × günler + o tarihlerin
 *   istisnaları. Ders oturumu (şablon, tarih) ile tanımlanıyor; Aşama 2'de
 *   rezervasyon da buna bağlanacak.
 *
 * Saat dilimi: program salonun yerel saatiyle (Europe/Istanbul). Türkiye
 * 2016'dan beri yıl boyu UTC+3, yaz saati yok; "bugün" ve "şimdi" bu sabit
 * farkla hesaplanıyor, telefonun saat dilimine ve Hermes'in Intl
 * desteğine bakılmıyor. Tarihler "YYYY-AA-GG" anahtarı, saatler "SS:DD".
 *
 * Fonksiyonlar fırlatmaz; account.ts'teki gibi `AccountResult` döner.
 * React ve Expo bilmez; test/classes.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult, GymMembership } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';
import type { KeyValueStore } from '@/lib/announcements';

export const NAME_MAX = 40;
export const INSTRUCTOR_MAX = 40;
export const TAGLINE_MAX = 60;
export const NOTE_MAX = 120;
export const DURATION_MIN = 5;
export const DURATION_MAX = 480;
export const DEFAULT_DURATION = 60;

/** Salonun saat dilimi: Europe/Istanbul = sabit UTC+3 */
export const GYM_UTC_OFFSET_MIN = 180;

/** 1 = Pazartesi … 7 = Pazar */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ClassTemplate {
  id: string;
  gymId: string;
  weekday: Weekday;
  /** "SS:DD" */
  startTime: string;
  durationMin: number;
  name: string;
  instructorName: string;
  tagline: string | null;
  active: boolean;
}

export type ExceptionKind = 'cancelled' | 'changed';

export interface ClassException {
  id: string;
  templateId: string;
  gymId: string;
  /** "YYYY-AA-GG" */
  date: string;
  kind: ExceptionKind;
  startTime: string | null;
  instructorName: string | null;
  note: string | null;
}

export interface ClassSchedule {
  templates: ClassTemplate[];
  exceptions: ClassException[];
}

/** Bir dersin belirli bir tarihteki hali */
export interface ClassOccurrence {
  /** Ders oturumu kimliği: `${templateId}:${date}` (Aşama 2: rezervasyon) */
  key: string;
  templateId: string;
  gymId: string;
  date: string;
  /** Etkin saat (değiştiyse yenisi) */
  startTime: string;
  endTime: string;
  durationMin: number;
  name: string;
  instructorName: string;
  tagline: string | null;
  status: 'normal' | ExceptionKind;
  /** Şablondaki saat (değiştiyse farklı) */
  originalStartTime: string;
  originalInstructorName: string;
  note: string | null;
  exception: ClassException | null;
}

// ============================================================================
// Tarih ve saat (salonun yerel takvimi)
// ============================================================================

export const WEEKDAY_SHORT_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const;
export const WEEKDAY_LONG_TR = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
] as const;
const MONTHS_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Salonda şu an: tarih ve gün içindeki dakika (telefonun diliminden bağımsız) */
export function gymNow(nowMs: number): { date: string; minutes: number } {
  const local = new Date(nowMs + GYM_UTC_OFFSET_MIN * 60_000);
  return {
    date: utcToKey(local.getTime()),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

export function addDays(key: string, days: number): string {
  return utcToKey(keyToUtc(key) + days * 86_400_000);
}

export function weekdayOf(key: string): Weekday {
  const js = new Date(keyToUtc(key)).getUTCDay(); // 0 = Pazar
  return (js === 0 ? 7 : js) as Weekday;
}

/** Haftanın pazartesisi */
export function weekStartOf(key: string): string {
  return addDays(key, 1 - weekdayOf(key));
}

/** Pazartesiden pazara 7 gün */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** "SS:DD" ya da sunucunun "SS:DD:ss" biçimi → gün içindeki dakika */
export function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Dakika → "SS:DD" (gece yarısını geçerse 24 saat içine sarar) */
export function formatMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function normalizeTime(text: string): string | null {
  const m = parseTime(text);
  return m == null ? null : formatMinutes(m);
}

/**
 * Saat girişi: yalnızca rakam, en fazla 4; iki rakamdan sonra ":".
 * "1930" → "19:30", "9" → "9".
 */
export function sanitizeTimeInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** "Perşembe 15 Ekim" */
export function formatDayLong(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${WEEKDAY_LONG_TR[weekdayOf(key) - 1]} ${d} ${MONTHS_TR[m - 1]}`;
}

/** Hafta aralığı: "12–18 Ekim", "28 Aralık – 3 Ocak" */
export function formatWeekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const [, m1, d1] = weekStart.split('-').map(Number);
  const [, m2, d2] = end.split('-').map(Number);
  return m1 === m2
    ? `${d1}–${d2} ${MONTHS_TR[m1 - 1]}`
    : `${d1} ${MONTHS_TR[m1 - 1]} – ${d2} ${MONTHS_TR[m2 - 1]}`;
}

export function dayOfMonth(key: string): number {
  return Number(key.split('-')[2]);
}

// ============================================================================
// Program hesabı
// ============================================================================

/** Bir tarihteki dersler, etkin saate göre sıralı. Pasif şablonlar yok. */
export function occurrencesForDate(schedule: ClassSchedule, date: string): ClassOccurrence[] {
  const weekday = weekdayOf(date);
  const byTemplate = new Map<string, ClassException>();
  for (const e of schedule.exceptions) if (e.date === date) byTemplate.set(e.templateId, e);

  const out: ClassOccurrence[] = [];
  for (const t of schedule.templates) {
    if (!t.active || t.weekday !== weekday) continue;
    const ex = byTemplate.get(t.id) ?? null;
    const changed = ex?.kind === 'changed' ? ex : null;
    const startTime = changed?.startTime ?? t.startTime;
    const start = parseTime(startTime) ?? 0;
    out.push({
      key: `${t.id}:${date}`,
      templateId: t.id,
      gymId: t.gymId,
      date,
      startTime,
      endTime: formatMinutes(start + t.durationMin),
      durationMin: t.durationMin,
      name: t.name,
      instructorName: changed?.instructorName ?? t.instructorName,
      tagline: t.tagline,
      status: ex?.kind ?? 'normal',
      originalStartTime: t.startTime,
      originalInstructorName: t.instructorName,
      note: ex?.note ?? null,
      exception: ex,
    });
  }
  return out.sort(
    (a, b) => (parseTime(a.startTime) ?? 0) - (parseTime(b.startTime) ?? 0) || a.name.localeCompare(b.name, 'tr')
  );
}

export function occurrencesForWeek(schedule: ClassSchedule, weekStart: string): Map<string, ClassOccurrence[]> {
  return new Map(weekDays(weekStart).map((d) => [d, occurrencesForDate(schedule, d)]));
}

/** Tek salonun programı */
export function scheduleForGym(schedule: ClassSchedule, gymId: string): ClassSchedule {
  return {
    templates: schedule.templates.filter((t) => t.gymId === gymId),
    exceptions: schedule.exceptions.filter((e) => e.gymId === gymId),
  };
}

/** Ders bitti mi (soluk gösterilir) */
export function isPast(o: Pick<ClassOccurrence, 'date' | 'endTime' | 'startTime'>, nowMs: number): boolean {
  const now = gymNow(nowMs);
  if (o.date !== now.date) return o.date < now.date;
  const start = parseTime(o.startTime) ?? 0;
  let end = parseTime(o.endTime) ?? 0;
  if (end <= start) end += 1440; // gece yarısını geçen ders
  return end <= now.minutes;
}

/** Değişikliğin kısa açıklaması: "Saat değişti: 19:30 · Hoca: Ayşe Hoca · not" */
export function changeSummary(o: ClassOccurrence): string | null {
  if (o.status !== 'changed') return null;
  const parts: string[] = [];
  if (o.startTime !== o.originalStartTime) parts.push(`Saat değişti: ${o.startTime}`);
  if (o.instructorName !== o.originalInstructorName) parts.push(`Hoca: ${o.instructorName}`);
  if (o.note) parts.push(o.note);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export type TodaySummary =
  | { kind: 'today'; date: string; items: ClassOccurrence[] }
  | { kind: 'tomorrow'; date: string; first: ClassOccurrence }
  | { kind: 'none' };

/**
 * Ana sayfa kartı: bugünün dersleri (iptal edilenler dahil, üstü çizili);
 * bugün ders yoksa yarının ilk (iptal edilmemiş) dersi.
 */
export function todaySummary(schedule: ClassSchedule, nowMs: number): TodaySummary {
  const today = gymNow(nowMs).date;
  const items = occurrencesForDate(schedule, today);
  if (items.length > 0) return { kind: 'today', date: today, items };
  const tomorrow = addDays(today, 1);
  const first = occurrencesForDate(schedule, tomorrow).find((o) => o.status !== 'cancelled');
  return first ? { kind: 'tomorrow', date: tomorrow, first } : { kind: 'none' };
}

/** Yönetici "Duyuru da paylaşılsın mı?" derse duyuru formuna */
export function exceptionAnnouncement(o: ClassOccurrence): { title: string; body: string } | null {
  const day = formatDayLong(o.date);
  if (o.status === 'cancelled') {
    return {
      title: `${o.name} dersi iptal`,
      body: `${day} ${o.originalStartTime} ${o.name} dersi iptal edildi.${o.note ? ` ${o.note}` : ''}`,
    };
  }
  if (o.status !== 'changed') return null;
  // Saatten sonra ek yok ("19:30'da" okunuşa göre değişir)
  const parts = [`${day} ${o.originalStartTime} ${o.name} dersinde değişiklik var.`];
  if (o.startTime !== o.originalStartTime) parts.push(`Yeni saat: ${o.startTime}.`);
  if (o.instructorName !== o.originalInstructorName) parts.push(`Dersi ${o.instructorName} verecek.`);
  if (o.note) parts.push(o.note);
  return { title: `${o.name} dersinde değişiklik`, body: parts.join(' ') };
}

// ============================================================================
// Formlar
// ============================================================================

const chars = (text: string) => [...text].length;

export interface TemplateDraft {
  weekday: Weekday;
  startTime: string;
  durationMin: string;
  name: string;
  instructorName: string;
  tagline: string;
  active: boolean;
}

export function emptyTemplateDraft(weekday: Weekday = 1): TemplateDraft {
  return {
    weekday,
    startTime: '',
    durationMin: String(DEFAULT_DURATION),
    name: '',
    instructorName: '',
    tagline: '',
    active: true,
  };
}

export function templateToDraft(t: ClassTemplate): TemplateDraft {
  return {
    weekday: t.weekday,
    startTime: t.startTime,
    durationMin: String(t.durationMin),
    name: t.name,
    instructorName: t.instructorName,
    tagline: t.tagline ?? '',
    active: t.active,
  };
}

export function templateDraftError(d: TemplateDraft): string | null {
  if (parseTime(d.startTime) == null) return 'Başlangıç saatini SS:DD biçiminde gir (ör. 19:30).';
  const duration = Number(d.durationMin);
  if (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) {
    return `Süre ${DURATION_MIN}–${DURATION_MAX} dakika olmalı.`;
  }
  if (d.name.trim().length === 0) return 'Ders adı boş olamaz.';
  if (chars(d.name.trim()) > NAME_MAX) return `Ders adı en fazla ${NAME_MAX} karakter olabilir.`;
  if (d.instructorName.trim().length === 0) return 'Hoca adı boş olamaz.';
  if (chars(d.instructorName.trim()) > INSTRUCTOR_MAX) return `Hoca adı en fazla ${INSTRUCTOR_MAX} karakter olabilir.`;
  if (chars(d.tagline.trim()) > TAGLINE_MAX) return `Slogan en fazla ${TAGLINE_MAX} karakter olabilir.`;
  return null;
}

export function isTemplateDraftDirty(d: TemplateDraft, original: TemplateDraft): boolean {
  return (
    d.weekday !== original.weekday ||
    normalizeTime(d.startTime) !== normalizeTime(original.startTime) ||
    d.durationMin.trim() !== original.durationMin.trim() ||
    d.name.trim() !== original.name.trim() ||
    d.instructorName.trim() !== original.instructorName.trim() ||
    d.tagline.trim() !== original.tagline.trim() ||
    d.active !== original.active
  );
}

/** Taslak → sunucu sütunları (doğrulanmış taslak) */
export function templateRow(d: TemplateDraft) {
  return {
    weekday: d.weekday,
    start_time: normalizeTime(d.startTime),
    duration_min: Number(d.durationMin),
    name: d.name.trim(),
    instructor_name: d.instructorName.trim(),
    tagline: d.tagline.trim() || null,
    active: d.active,
  };
}

export interface ChangeDraft {
  startTime: string;
  instructorName: string;
  note: string;
}

export function changeDraftFor(o: ClassOccurrence): ChangeDraft {
  const changed = o.status === 'changed';
  return {
    startTime: o.startTime,
    instructorName: o.instructorName,
    note: changed ? (o.note ?? '') : '',
  };
}

/**
 * "Bu ders için değiştir" formu; geçerliyse null. Şablondakiyle aynı
 * alanlar değişiklik sayılmaz; hiçbir şey değişmediyse hata.
 */
export function changeDraftError(d: ChangeDraft, o: ClassOccurrence): string | null {
  if (parseTime(d.startTime) == null) return 'Saati SS:DD biçiminde gir (ör. 19:30).';
  if (d.instructorName.trim().length === 0) return 'Hoca adı boş olamaz.';
  if (chars(d.instructorName.trim()) > INSTRUCTOR_MAX) return `Hoca adı en fazla ${INSTRUCTOR_MAX} karakter olabilir.`;
  if (chars(d.note.trim()) > NOTE_MAX) return `Not en fazla ${NOTE_MAX} karakter olabilir.`;
  const row = changeRow(d, o);
  if (row.start_time == null && row.instructor_name == null && row.note == null) {
    return 'Değişiklik yok: saat, hoca ya da not gir.';
  }
  return null;
}

/** Değişiklik → sunucu sütunları; şablondakiyle aynı alan null */
export function changeRow(d: ChangeDraft, o: Pick<ClassOccurrence, 'originalStartTime' | 'originalInstructorName'>) {
  const start = normalizeTime(d.startTime);
  const instructor = d.instructorName.trim();
  return {
    kind: 'changed' as const,
    start_time: start != null && start !== o.originalStartTime ? start : null,
    instructor_name: instructor && instructor !== o.originalInstructorName ? instructor : null,
    note: d.note.trim() || null,
  };
}

// ============================================================================
// Rol (görünüm için)
// ============================================================================

/** Programı yalnızca yönetici düzenler */
export function canEditSchedule(
  gymId: string | null,
  memberships: readonly Pick<GymMembership, 'gymId' | 'role'>[]
): boolean {
  return gymId != null && memberships.some((m) => m.gymId === gymId && m.role === 'admin');
}

/** Yalnızca bugün ve sonrası için istisna (geçmiş tarihe dokunulmaz) */
export function canChangeOccurrence(o: Pick<ClassOccurrence, 'date'>, nowMs: number): boolean {
  return o.date >= gymNow(nowMs).date;
}

// ============================================================================
// Sunucu satırları
// ============================================================================

const isStr = (v: unknown): v is string => typeof v === 'string';

export function parseTemplateRows(data: unknown): ClassTemplate[] {
  if (!Array.isArray(data)) return [];
  const out: ClassTemplate[] = [];
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    const start = isStr(r?.start_time) ? normalizeTime(r.start_time) : null;
    const weekday = Number(r?.weekday);
    if (
      !isStr(r?.id) ||
      !isStr(r.gym_id) ||
      !isStr(r.name) ||
      !isStr(r.instructor_name) ||
      start == null ||
      !Number.isInteger(weekday) ||
      weekday < 1 ||
      weekday > 7
    ) {
      continue;
    }
    const duration = Number(r.duration_min);
    out.push({
      id: r.id,
      gymId: r.gym_id,
      weekday: weekday as Weekday,
      startTime: start,
      durationMin: Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_DURATION,
      name: r.name,
      instructorName: r.instructor_name,
      tagline: isStr(r.tagline) && r.tagline.trim() ? r.tagline : null,
      active: r.active !== false,
    });
  }
  return out;
}

export function parseExceptionRows(data: unknown): ClassException[] {
  if (!Array.isArray(data)) return [];
  const out: ClassException[] = [];
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    if (
      !isStr(r?.id) ||
      !isStr(r.template_id) ||
      !isStr(r.gym_id) ||
      !isStr(r.date) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
      (r.kind !== 'cancelled' && r.kind !== 'changed')
    ) {
      continue;
    }
    out.push({
      id: r.id,
      templateId: r.template_id,
      gymId: r.gym_id,
      date: r.date,
      kind: r.kind,
      startTime: isStr(r.start_time) ? normalizeTime(r.start_time) : null,
      instructorName: isStr(r.instructor_name) ? r.instructor_name : null,
      note: isStr(r.note) ? r.note : null,
    });
  }
  return out;
}

// ============================================================================
// Önbellek (kv-store, kullanıcıya göre)
// ============================================================================

export interface ScheduleCache extends ClassSchedule {
  fetchedAt: string;
}

export const scheduleCacheKey = (userId: string) => `classes.cache.${userId}`;

export async function readScheduleCache(store: KeyValueStore, userId: string): Promise<ScheduleCache | null> {
  try {
    const raw = await store.getItem(scheduleCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; templates?: unknown; exceptions?: unknown };
    if (!isStr(parsed.fetchedAt) || !Array.isArray(parsed.templates) || !Array.isArray(parsed.exceptions)) {
      return null;
    }
    // Önbellekteki biçim uygulama tipi: sunucu satırı gibi aynı denetimden geçsin
    const templates = parseTemplateRows(
      (parsed.templates as ClassTemplate[]).map((t) => ({
        id: t?.id,
        gym_id: t?.gymId,
        weekday: t?.weekday,
        start_time: t?.startTime,
        duration_min: t?.durationMin,
        name: t?.name,
        instructor_name: t?.instructorName,
        tagline: t?.tagline,
        active: t?.active,
      }))
    );
    const exceptions = parseExceptionRows(
      (parsed.exceptions as ClassException[]).map((e) => ({
        id: e?.id,
        template_id: e?.templateId,
        gym_id: e?.gymId,
        date: e?.date,
        kind: e?.kind,
        start_time: e?.startTime,
        instructor_name: e?.instructorName,
        note: e?.note,
      }))
    );
    return { fetchedAt: parsed.fetchedAt, templates, exceptions };
  } catch {
    return null;
  }
}

export async function writeScheduleCache(store: KeyValueStore, userId: string, cache: ScheduleCache): Promise<void> {
  await store.setItem(scheduleCacheKey(userId), JSON.stringify(cache));
}

// ============================================================================
// Supabase
// ============================================================================

const ok = <T>(value: T): AccountResult<T> => ({ ok: true, value });
const fail = <T>(kind: Parameters<typeof accountError>[0]): AccountResult<T> => ({
  ok: false,
  error: accountError(kind),
});
const err = <T>(e: unknown): AccountResult<T> => ({ ok: false, error: toAccountError(e) });

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return fail('not_configured');
  try {
    return await fn(client);
  } catch (e) {
    console.error('[CLASSES] HATA:', e);
    return err(e);
  }
}

const TEMPLATE_COLUMNS = 'id, gym_id, weekday, start_time, duration_min, name, instructor_name, tagline, active';
const EXCEPTION_COLUMNS = 'id, template_id, gym_id, date, kind, start_time, instructor_name, note';

/** Geçmiş istisnalar bu kadar gün geriye kadar çekilir (önceki hafta okları) */
export const EXCEPTION_LOOKBACK_DAYS = 28;

/** Üyesi olunan bütün salonların programı (RLS süzüyor) */
export function fetchSchedule(client: SupabaseClient | null, nowMs: number = Date.now()) {
  return run<ClassSchedule>(client, async (c) => {
    const since = addDays(gymNow(nowMs).date, -EXCEPTION_LOOKBACK_DAYS);
    const [templates, exceptions] = await Promise.all([
      c.from('class_templates').select(TEMPLATE_COLUMNS).order('weekday').order('start_time').limit(500),
      c.from('class_exceptions').select(EXCEPTION_COLUMNS).gte('date', since).order('date').limit(1000),
    ]);
    if (templates.error) return err(templates.error);
    if (exceptions.error) return err(exceptions.error);
    return ok({
      templates: parseTemplateRows(templates.data),
      exceptions: parseExceptionRows(exceptions.data),
    });
  });
}

export function createTemplate(client: SupabaseClient | null, gymId: string, draft: TemplateDraft) {
  return run<ClassTemplate>(client, async (c) => {
    const { data, error } = await c
      .from('class_templates')
      .insert({ gym_id: gymId, ...templateRow(draft) })
      .select(TEMPLATE_COLUMNS)
      .single();
    if (error) return err(error);
    const [row] = parseTemplateRows([data]);
    return row ? ok(row) : fail('unknown');
  });
}

/** RLS izin vermezse satır güncellenmez ve hata gelmez → "yetkin yok" */
export function updateTemplate(client: SupabaseClient | null, id: string, draft: TemplateDraft) {
  return run<ClassTemplate>(client, async (c) => {
    const { data, error } = await c
      .from('class_templates')
      .update(templateRow(draft))
      .eq('id', id)
      .select(TEMPLATE_COLUMNS);
    if (error) return err(error);
    const [row] = parseTemplateRows(data);
    return row ? ok(row) : fail('forbidden');
  });
}

export function deleteTemplate(client: SupabaseClient | null, id: string) {
  return run<null>(client, async (c) => {
    const { data, error } = await c.from('class_templates').delete().eq('id', id).select('id');
    if (error) return err(error);
    return Array.isArray(data) && data.length > 0 ? ok(null) : fail('forbidden');
  });
}

export type ExceptionInput =
  | { kind: 'cancelled' }
  | { kind: 'changed'; start_time: string | null; instructor_name: string | null; note: string | null };

/**
 * Bir dersin o tarihteki istisnası: varsa güncellenir, yoksa eklenir.
 * (Upsert yok: tarih ve ders sütunlarına güncelleme yetkisi verilmiyor.)
 */
export function setException(client: SupabaseClient | null, o: ClassOccurrence, input: ExceptionInput) {
  return run<ClassException>(client, async (c) => {
    const values =
      input.kind === 'cancelled'
        ? { kind: 'cancelled', start_time: null, instructor_name: null, note: null }
        : input;
    const query = o.exception
      ? c.from('class_exceptions').update(values).eq('id', o.exception.id).select(EXCEPTION_COLUMNS)
      : c
          .from('class_exceptions')
          .insert({ template_id: o.templateId, date: o.date, ...values })
          .select(EXCEPTION_COLUMNS);
    const { data, error } = await query;
    if (error) return err(error);
    const [row] = parseExceptionRows(data);
    return row ? ok(row) : fail('forbidden');
  });
}

export function removeException(client: SupabaseClient | null, exceptionId: string) {
  return run<null>(client, async (c) => {
    const { data, error } = await c.from('class_exceptions').delete().eq('id', exceptionId).select('id');
    if (error) return err(error);
    return Array.isArray(data) && data.length > 0 ? ok(null) : fail('forbidden');
  });
}
