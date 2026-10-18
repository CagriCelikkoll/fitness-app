/**
 * notify Edge Function'ının saf mantığı (v3.3): webhook'tan olayı
 * çıkarma, alıcı seçimi (tercih filtresi, yazar hariç), bildirim metni,
 * Expo Push mesajları ve geçersiz token'lar. v3.6a: hoca isteği (öğrenciye)
 * ve kabulü (hocaya).
 *
 * Deno ve Node'da aynı çalışır: hiçbir şey içe aktarmaz, ağa çıkmaz.
 * Vitest: test/pushNotify.test.ts. Uygulama tarafındaki karşılığı
 * (bildirime dokununca açılacak ekran) src/lib/push.ts; veri biçimi ve
 * kanal kimlikleri ikisinde aynı (test denetliyor).
 */

// ============================================================================
// Ortak sözleşme (uygulamayla aynı)
// ============================================================================

/** Android bildirim kanalları; uygulama aynı kimliklerle kuruyor */
export const CHANNEL_ANNOUNCEMENTS = 'announcements';
export const CHANNEL_CLASS_CHANGES = 'class-changes';
export const CHANNEL_TRAINER = 'trainer';

export const PUSH_TYPE_ANNOUNCEMENT = 'announcement';
export const PUSH_TYPE_CLASS_CHANGE = 'class-change';
export const PUSH_TYPE_TRAINER_REQUEST = 'trainer-request';
export const PUSH_TYPE_TRAINER_ACCEPTED = 'trainer-accepted';

export type PushData =
  | { type: typeof PUSH_TYPE_ANNOUNCEMENT; gymId: string; announcementId: string }
  | { type: typeof PUSH_TYPE_CLASS_CHANGE; gymId: string; templateId: string; date: string }
  | { type: typeof PUSH_TYPE_TRAINER_REQUEST; gymId: string; linkId: string }
  | { type: typeof PUSH_TYPE_TRAINER_ACCEPTED; gymId: string; linkId: string };

/** Salonun saati: sabit UTC+3 (src/lib/classes.ts GYM_UTC_OFFSET_MIN ile aynı) */
export const GYM_UTC_OFFSET_MIN = 180;

// ============================================================================
// Webhook → olay
// ============================================================================

export type ClassChange = 'cancelled' | 'changed' | 'restored';

export interface AnnouncementEvent {
  kind: 'announcement';
  gymId: string;
  announcementId: string;
  authorId: string | null;
  title: string;
  body: string;
}

export interface ClassChangeEvent {
  kind: 'class';
  change: ClassChange;
  gymId: string;
  templateId: string;
  /** YYYY-MM-DD */
  date: string;
  /** Değişen saat ("HH:MM[:SS]") ya da null */
  startTime: string | null;
  instructorName: string | null;
  note: string | null;
  /** Değişiklikten önce de değişiklik vardıysa onun saati (UPDATE) */
  previousStartTime: string | null;
}

/** Hoca–öğrenci (v3.6a): yeni istek → öğrenciye, kabul → hocaya */
export interface TrainerEvent {
  kind: 'trainer';
  change: 'requested' | 'accepted';
  linkId: string;
  gymId: string;
  trainerId: string;
  studentId: string;
}

export type NotifyEvent = AnnouncementEvent | ClassChangeEvent | TrainerEvent;

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const isRow = (v: unknown): v is Row => v != null && typeof v === 'object' && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ders istisnasının bildirime giren alanları */
function exceptionKey(r: Row): string {
  return JSON.stringify([r.kind, str(r.start_time), str(r.instructor_name), str(r.note)]);
}

/**
 * Supabase Database Webhook gövdesi:
 * `{ type: 'INSERT' | 'UPDATE' | 'DELETE', table, schema, record, old_record }`.
 *
 * - announcements INSERT → duyuru
 * - class_exceptions INSERT → iptal / değişiklik
 * - class_exceptions UPDATE → yalnızca tür, saat, hoca ya da not değiştiyse
 * - class_exceptions DELETE → iptal / değişiklik geri alındı ("programda")
 * - trainer_students INSERT (pending) → istek; UPDATE pending → active → kabul
 *
 * Başka her şey null (bildirim yok).
 */
export function parseWebhook(payload: unknown): NotifyEvent | null {
  if (!isRow(payload) || payload.schema !== 'public') return null;
  const type = payload.type;
  const record = isRow(payload.record) ? payload.record : null;
  const old = isRow(payload.old_record) ? payload.old_record : null;

  if (payload.table === 'announcements') {
    if (type !== 'INSERT' || !record) return null;
    const gymId = str(record.gym_id);
    const id = str(record.id);
    const title = str(record.title);
    const body = str(record.body);
    if (!gymId || !id || !title || !body) return null;
    return { kind: 'announcement', gymId, announcementId: id, authorId: str(record.author_id), title, body };
  }

  if (payload.table === 'class_exceptions') {
    const row = type === 'DELETE' ? old : record;
    if (!row) return null;
    const gymId = str(row.gym_id);
    const templateId = str(row.template_id);
    const date = str(row.date);
    if (!gymId || !templateId || !date || !DATE_RE.test(date)) return null;
    const base = { kind: 'class' as const, gymId, templateId, date };

    if (type === 'DELETE') {
      return { ...base, change: 'restored', startTime: null, instructorName: null, note: null, previousStartTime: null };
    }
    if (type !== 'INSERT' && type !== 'UPDATE') return null;
    if (type === 'UPDATE' && old && exceptionKey(old) === exceptionKey(row)) return null;
    if (row.kind !== 'cancelled' && row.kind !== 'changed') return null;
    return {
      ...base,
      change: row.kind,
      startTime: row.kind === 'changed' ? str(row.start_time) : null,
      instructorName: row.kind === 'changed' ? str(row.instructor_name) : null,
      note: str(row.note),
      previousStartTime: type === 'UPDATE' && old?.kind === 'changed' ? str(old.start_time) : null,
    };
  }

  if (payload.table === 'trainer_students') {
    if (!record) return null;
    const linkId = str(record.id);
    const gymId = str(record.gym_id);
    const trainerId = str(record.trainer_id);
    const studentId = str(record.student_id);
    if (!linkId || !gymId || !trainerId || !studentId) return null;
    const base = { kind: 'trainer' as const, linkId, gymId, trainerId, studentId };
    if (type === 'INSERT' && record.status === 'pending') return { ...base, change: 'requested' };
    if (type === 'UPDATE' && old?.status === 'pending' && record.status === 'active') {
      return { ...base, change: 'accepted' };
    }
    return null;
  }
  return null;
}

// ============================================================================
// Alıcılar
// ============================================================================

export interface PrefsRow {
  user_id: string;
  notify_announcements: boolean;
  notify_class_changes: boolean;
}

export interface TokenRow {
  token: string;
  user_id: string;
}

/**
 * Bildirim gidecek token'lar: adaylardan (salon üyeleri ya da derse
 * katılacaklar) yazarı çıkar, tercihi kapalı olanları çıkar (satırı
 * olmayan açık sayılır), kalanların token'ları. Tekil.
 */
export function recipientTokens(
  candidateUserIds: readonly string[],
  options: {
    /** personal: tercih filtresi yok (yalnızca o kişiye giden hoca bildirimleri) */
    kind: 'announcements' | 'classChanges' | 'personal';
    excludeUserId?: string | null;
    prefs: readonly PrefsRow[];
    tokens: readonly TokenRow[];
  }
): string[] {
  const prefs = new Map(options.prefs.map((p) => [p.user_id, p]));
  const allowed = new Set<string>();
  for (const id of candidateUserIds) {
    if (id === options.excludeUserId) continue;
    const p = prefs.get(id);
    const on =
      p == null || options.kind === 'personal'
        ? true
        : options.kind === 'announcements'
          ? p.notify_announcements
          : p.notify_class_changes;
    if (on) allowed.add(id);
  }
  const out = new Set<string>();
  for (const t of options.tokens) if (allowed.has(t.user_id)) out.add(t.token);
  return [...out];
}

// ============================================================================
// Metinler
// ============================================================================

export interface PushContent {
  title: string;
  body: string;
}

const BODY_MAX = 160;

/** Uzun metni kelime sınırında kısalt */
export function truncate(text: string, max = BODY_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if ([...clean].length <= max) return clean;
  const cut = [...clean].slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function announcementContent(e: AnnouncementEvent): PushContent {
  return { title: truncate(e.title, 80), body: truncate(e.body) };
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** "HH:MM:SS" → "HH:MM" */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** Salon takviminde bugün (YYYY-MM-DD) */
export function gymToday(nowMs: number): string {
  return new Date(nowMs + GYM_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Dersin başlangıcı (UTC ms), salon saatiyle */
export function classStartMs(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - GYM_UTC_OFFSET_MIN * 60_000;
}

/** "Bugün", "Yarın" ya da "16 Ekim Cuma" */
export function dayText(date: string, nowMs: number): string {
  const today = gymToday(nowMs);
  const dayMs = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  const todayMs = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const diff = Math.round((dayMs - todayMs) / 86_400_000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  const d = new Date(dayMs);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${WEEKDAYS[d.getUTCDay()]}`;
}

export interface ClassTemplateInfo {
  name: string;
  /** Programdaki saat */
  start_time: string;
}

/**
 * Ders iptali / değişikliği / geri alma metni. Başlık dersin adı ve ne
 * olduğu; gövde gün, saat ve (varsa) hoca, not.
 */
export function classChangeContent(e: ClassChangeEvent, template: ClassTemplateInfo, nowMs: number): PushContent {
  const day = dayText(e.date, nowMs);
  const planned = hhmm(template.start_time);
  const note = e.note ? ` Not: ${e.note}` : '';

  if (e.change === 'cancelled') {
    return { title: `${template.name} iptal`, body: truncate(`${day} ${planned} dersi yapılmayacak.${note}`) };
  }
  if (e.change === 'restored') {
    return { title: `${template.name} programda`, body: truncate(`${day} ${planned} dersi normal programında yapılacak.`) };
  }
  const parts: string[] = [];
  const newTime = e.startTime ? hhmm(e.startTime) : null;
  const before = e.previousStartTime ? hhmm(e.previousStartTime) : planned;
  if (newTime && newTime !== before) parts.push(`${day} ${before} yerine ${newTime}.`);
  else parts.push(`${day} ${newTime ?? planned}.`);
  if (e.instructorName) parts.push(`Hoca: ${e.instructorName}.`);
  return { title: `${template.name} dersinde değişiklik`, body: truncate(`${parts.join(' ')}${note}`) };
}

/**
 * Ders bildirimi gönderilir mi: dersin (değişmiş saatiyle) başlangıcı
 * henüz geçmediyse. Geçmiş bir günün düzeltmesi kimseyi uyandırmasın.
 */
export function isUpcomingClass(e: ClassChangeEvent, template: ClassTemplateInfo, nowMs: number): boolean {
  const time = e.change === 'changed' && e.startTime ? e.startTime : template.start_time;
  const plannedStart = classStartMs(e.date, template.start_time);
  return Math.max(classStartMs(e.date, time), plannedStart) > nowMs;
}

/** "Duygu" → "Duygu Hoca" (src/lib/trainers.ts trainerTitle ile aynı; test denetliyor) */
export function trainerTitle(name: string | null | undefined): string {
  const n = name?.trim();
  if (!n) return 'Hocan';
  return /\bhoca$/i.test(n) ? n : `${n} Hoca`;
}

/** Hoca bildirimi: istek öğrenciye, kabul hocaya */
export function trainerContent(
  e: TrainerEvent,
  names: { trainerName: string | null; studentName: string | null }
): PushContent {
  if (e.change === 'requested') {
    const who = names.trainerName?.trim() ? trainerTitle(names.trainerName) : 'Bir hoca';
    return { title: 'Hoca isteği', body: truncate(`${who} seni öğrencisi olarak eklemek istiyor.`) };
  }
  const student = names.studentName?.trim() || 'Öğrencin';
  return { title: 'Yeni öğrenci', body: truncate(`${student} isteğini kabul etti.`) };
}

/** Bildirimin gideceği kişi */
export function trainerRecipient(e: TrainerEvent): string {
  return e.change === 'requested' ? e.studentId : e.trainerId;
}

// ============================================================================
// Expo Push
// ============================================================================

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo'nun istek başına sınırı */
export const EXPO_BATCH = 100;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: 'default';
  channelId: string;
  priority: 'high';
}

export function dataFor(e: NotifyEvent): PushData {
  if (e.kind === 'announcement') return { type: PUSH_TYPE_ANNOUNCEMENT, gymId: e.gymId, announcementId: e.announcementId };
  if (e.kind === 'trainer') {
    return {
      type: e.change === 'requested' ? PUSH_TYPE_TRAINER_REQUEST : PUSH_TYPE_TRAINER_ACCEPTED,
      gymId: e.gymId,
      linkId: e.linkId,
    };
  }
  return { type: PUSH_TYPE_CLASS_CHANGE, gymId: e.gymId, templateId: e.templateId, date: e.date };
}

function channelFor(e: NotifyEvent): string {
  if (e.kind === 'announcement') return CHANNEL_ANNOUNCEMENTS;
  if (e.kind === 'trainer') return CHANNEL_TRAINER;
  return CHANNEL_CLASS_CHANGES;
}

export function buildMessages(tokens: readonly string[], e: NotifyEvent, content: PushContent): ExpoMessage[] {
  const data = dataFor(e);
  const channelId = channelFor(e);
  return tokens.map((to) => ({ to, ...content, data, sound: 'default', channelId, priority: 'high' }));
}

export function chunk<T>(list: readonly T[], size = EXPO_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Expo yanıtındaki biletler mesajlarla aynı sırada. "DeviceNotRegistered"
 * (uygulama kaldırılmış / token geçersiz) olan token'lar silinecek.
 */
export function invalidTokens(messages: readonly Pick<ExpoMessage, 'to'>[], response: unknown): string[] {
  const tickets = isRow(response) && Array.isArray(response.data) ? response.data : [];
  const out = new Set<string>();
  tickets.forEach((t, i) => {
    if (!isRow(t) || t.status !== 'error') return;
    const details = isRow(t.details) ? t.details : {};
    if (details.error !== 'DeviceNotRegistered') return;
    const token = str(details.expoPushToken) ?? messages[i]?.to;
    if (token) out.add(token);
  });
  return [...out];
}
