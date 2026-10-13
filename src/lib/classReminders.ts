/**
 * Ders hatırlatması (v3.2c BÖLÜM 5.3) — "Katılıyorum" diyen üyeye ders
 * başlamadan 1 saat önce telefonda YEREL bildirim. Push yok, sunucu yok.
 *
 * Karar mantığı burada (saf, test edilir); expo-notifications çağrıları
 * `classReminderNative.ts`'te. Dinlenme bildirimiyle aynı düzen.
 *
 * - Zaman salonun saatiyle (Europe/Istanbul, sabit UTC+3): telefon başka
 *   dilimdeyse de ders saatinden 1 saat önce.
 * - İstenen hatırlatmalar her seferinde baştan hesaplanır ve telefondaki
 *   planlı olanlarla karşılaştırılır: vazgeçilen, iptal edilen, saati
 *   değişen dersin eski bildirimi kalkar.
 * - Ayarlar'daki bildirim anahtarı kapalıysa ya da izin yoksa hiçbiri
 *   planlanmaz (var olanlar kaldırılır).
 */

import { GYM_UTC_OFFSET_MIN, occurrencesForDate, parseTime, type ClassOccurrence, type ClassSchedule } from '@/lib/classes';

export const REMINDER_LEAD_MIN = 60;
export const CLASS_REMINDER_PREFIX = 'class-reminder:';
export const CLASS_REMINDER_TYPE = 'class-reminder';

export interface ClassReminder {
  /** Bildirim kimliği: önek + oturum + zaman (saat değişince yeni kimlik) */
  id: string;
  fireAtMs: number;
  title: string;
  body: string;
  data: ClassReminderData;
}

export interface ClassReminderData {
  type: typeof CLASS_REMINDER_TYPE;
  gymId: string;
  templateId: string;
  date: string;
}

/** Dersin başlangıcı (UTC ms), salonun yerel saatinden */
export function classStartMs(date: string, startTime: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const minutes = parseTime(startTime) ?? 0;
  return Date.UTC(y, m - 1, d, 0, minutes) - GYM_UTC_OFFSET_MIN * 60_000;
}

export function reminderFireAtMs(o: Pick<ClassOccurrence, 'date' | 'startTime'>): number {
  return classStartMs(o.date, o.startTime) - REMINDER_LEAD_MIN * 60_000;
}

/**
 * Saatin bulunma eki: "18:00'de", "19:00'da", "19:15'te", "19:30'da".
 * Ek, okunuştaki son kelimeye göre (dakika sıfırsa saat).
 */
export function atTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const n = m === 0 ? h : m;
  const ones = n % 10;
  const tens = Math.floor(n / 10) % 10;
  // Son kelime: birler basamağı ya da (birler 0 ise) onlar / "sıfır"
  const last = ones !== 0 ? ONES[ones] : n === 0 ? 'sıfır' : TENS[tens];
  return `${time}'${suffixFor(last)}`;
}

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli'];

function suffixFor(word: string): string {
  const vowels = word.match(/[aeıioöuü]/g) ?? [];
  const lastVowel = vowels[vowels.length - 1] ?? 'e';
  const back = 'aıou'.includes(lastVowel);
  // Sert ünsüzle bitiyorsa t (fıstıkçı şahap)
  const hard = 'fstkçşhp'.includes(word[word.length - 1]);
  return `${hard ? 't' : 'd'}${back ? 'a' : 'e'}`;
}

export function reminderContent(o: Pick<ClassOccurrence, 'name' | 'startTime'>): { title: string; body: string } {
  return {
    title: `${o.name} ${atTime(o.startTime)} başlıyor`,
    body: 'Gelemeyeceksen yerini boşalt.',
  };
}

/** Katıldığım oturumların bugünkü hali (program + istisna) */
export function myOccurrences(schedule: ClassSchedule, mine: readonly string[]): ClassOccurrence[] {
  const byDate = new Map<string, ClassOccurrence[]>();
  const out: ClassOccurrence[] = [];
  for (const key of mine) {
    const date = key.slice(key.lastIndexOf(':') + 1);
    if (!byDate.has(date)) byDate.set(date, occurrencesForDate(schedule, date));
    const o = byDate.get(date)!.find((x) => x.key === key);
    if (o) out.push(o);
  }
  return out;
}

/** İstenen hatırlatmalar: iptal edilmemiş, zamanı gelmemiş */
export function planReminders(occurrences: readonly ClassOccurrence[], nowMs: number): ClassReminder[] {
  const out: ClassReminder[] = [];
  for (const o of occurrences) {
    if (o.status === 'cancelled') continue;
    const fireAtMs = reminderFireAtMs(o);
    if (fireAtMs <= nowMs) continue;
    out.push({
      id: `${CLASS_REMINDER_PREFIX}${o.key}:${fireAtMs}`,
      fireAtMs,
      ...reminderContent(o),
      data: { type: CLASS_REMINDER_TYPE, gymId: o.gymId, templateId: o.templateId, date: o.date },
    });
  }
  return out;
}

/** Telefondaki planlı hatırlatmalarla fark */
export function diffReminders(
  desired: readonly ClassReminder[],
  scheduledIds: readonly string[]
): { cancel: string[]; schedule: ClassReminder[] } {
  const want = new Set(desired.map((r) => r.id));
  const have = new Set(scheduledIds.filter((id) => id.startsWith(CLASS_REMINDER_PREFIX)));
  return {
    cancel: [...have].filter((id) => !want.has(id)),
    schedule: desired.filter((r) => !have.has(r.id)),
  };
}

/** Bildirime dokununca: hangi gün, hangi ders */
export function reminderTarget(data: unknown): { date: string; key: string; gymId: string } | null {
  const d = data as Partial<ClassReminderData> | null;
  if (
    d?.type !== CLASS_REMINDER_TYPE ||
    typeof d.templateId !== 'string' ||
    typeof d.gymId !== 'string' ||
    typeof d.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(d.date)
  ) {
    return null;
  }
  return { date: d.date, key: `${d.templateId}:${d.date}`, gymId: d.gymId };
}

// ============================================================================
// Eşleştirici (native katman enjekte edilir)
// ============================================================================

export interface ClassReminderApi {
  /** İzin verilmiş mi (sormadan) */
  isGranted(): Promise<boolean>;
  /** Bildirim anahtarı (Ayarlar) açık mı */
  isEnabled(): Promise<boolean>;
  /** Planlı bildirimlerin kimlikleri (yalnızca bizimkiler süzülür) */
  scheduledIds(): Promise<string[]>;
  schedule(reminder: ClassReminder): Promise<void>;
  cancel(id: string): Promise<void>;
}

/**
 * `sync(occurrences)` istenen durumu telefona yansıtır. Çağrılar sıraya
 * girer (aynı anda iki eşleştirme aynı bildirimi iki kez planlamasın).
 * İzin yoksa ya da anahtar kapalıysa yalnızca kaldırır. Hata fırlatmaz.
 */
export function createClassReminderSync(
  api: ClassReminderApi,
  deps: { now?: () => number; onError?: (err: unknown) => void } = {}
) {
  const now = deps.now ?? Date.now;
  let queue: Promise<void> = Promise.resolve();

  const run = async (occurrences: readonly ClassOccurrence[]) => {
    const [granted, enabled, scheduled] = await Promise.all([api.isGranted(), api.isEnabled(), api.scheduledIds()]);
    const desired = granted && enabled ? planReminders(occurrences, now()) : [];
    const diff = diffReminders(desired, scheduled);
    for (const id of diff.cancel) await api.cancel(id);
    for (const r of diff.schedule) await api.schedule(r);
  };

  return {
    sync(occurrences: readonly ClassOccurrence[]): Promise<void> {
      queue = queue
        .then(() => run(occurrences))
        .catch((err) => {
          deps.onError?.(err);
        });
      return queue;
    },
  };
}
