/**
 * Ana sayfa "Bugün" (v4.0a Bölüm 3) — saf hesaplar ve tek okuma.
 *
 * - Tarih başlığı, haftalık gün şeridi ve ekran okuyucu özeti
 * - "Sıradaki" rutin: programdaki sıradaki gün; program yoksa en uzun
 *   süredir yapılmayan rutin (hiç yapılmamışlar önce)
 * - Rutin kartı satırı: hareket sayısı · süre tahmini · en çok çalışan kaslar
 * - Haftalık hacim (bu hafta / geçen hafta) ve son kırılan rekor
 *
 * Hacim ve rekorda yalnızca tamamlanmış normal setler (ısınma hariç).
 */

import { and, asc, count, eq, isNotNull, max } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { exercises, routineExercises, routines, sessionExercises, sets, workoutSessions } from '@/db/schema';
import { contextColorFor, type BodyContext } from '@/lib/contextColor';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { epley, findSessionRecordSetIds, type SessionSet } from '@/lib/exerciseProgress';
import { muscleLabel } from '@/lib/exerciseTaxonomy';
import { toDateKey } from '@/lib/format';
import { sessionVolumesQuery, startOfWeek } from '@/lib/weeklyVolume';

// ── Tarih ve hafta şeridi ───────────────────────────────────────────────

export const WEEKDAY_SHORT = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'] as const;
export const WEEKDAY_LONG = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'] as const;
export const MONTHS_LONG = [
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

/** Pazartesi 0 … Pazar 6 */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** "Cumartesi, 7 Kasım" (ay ve gün adları elle: Hermes'te Intl cihaza göre değişebiliyor) */
export function todayHeading(now: Date): string {
  return `${WEEKDAY_LONG[mondayIndex(now)]}, ${now.getDate()} ${MONTHS_LONG[now.getMonth()]}`;
}

export interface WeekDay {
  key: string;
  short: (typeof WEEKDAY_SHORT)[number];
  long: (typeof WEEKDAY_LONG)[number];
  done: boolean;
  today: boolean;
}

/** Bu haftanın 7 günü (Pt…Pz): antrenman yapıldı mı, bugün mü */
export function weekStrip(dayKeys: ReadonlySet<string>, now: Date): WeekDay[] {
  const monday = startOfWeek(now);
  const todayKey = toDateKey(now);
  return WEEKDAY_SHORT.map((short, i) => {
    // Yerel tarih kurucusu: yaz saati geçişinde gün kaymasın
    const key = toDateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
    return { key, short, long: WEEKDAY_LONG[i]!, done: dayKeys.has(key), today: key === todayKey };
  });
}

function joinTr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ve ${items[items.length - 1]}`;
}

/**
 * Ekran okuyucu özeti: "Bu hafta 2 / 4 antrenman. Pazartesi ve Çarşamba
 * antrenman yapıldı. Bugün Cumartesi."
 */
export function weekSummaryLabel(strip: readonly WeekDay[], done: number, goal: number | null): string {
  const head = goal != null ? `Bu hafta ${done} / ${goal} antrenman.` : `Bu hafta ${done} antrenman.`;
  const doneDays = strip.filter((d) => d.done).map((d) => d.long);
  const days = doneDays.length > 0 ? ` ${joinTr(doneDays)} antrenman yapıldı.` : '';
  const today = strip.find((d) => d.today);
  return `${head}${days}${today ? ` Bugün ${today.long}.` : ''}`;
}

/** Seri çipi: mevcut kural (2 hafta ve üstü); yoksa çip yok */
export function streakChipText(streak: number): string | null {
  return streak >= 2 ? `${streak} haftalık seri` : null;
}

// ── Sıradaki rutin ──────────────────────────────────────────────────────

export interface RoutineCandidate {
  id: string;
  name: string;
  createdAt: string;
  /** Bu rutinle yapılmış son bitmiş antrenmanın başlangıcı */
  lastDoneAt: string | null;
}

export interface RoutineLinkLike {
  routineId: string;
  programId: string;
  dayIndex: number;
}

export interface NextRoutinePick {
  routineId: string;
  /** Programın parçasıysa "Gün 2 / 4" */
  dayLabel: string | null;
}

function laterIso(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

/**
 * Programdaki sıradaki gün: programın en son yapılan gününden sonraki
 * (sona gelince başa döner); hiçbir günü yapılmadıysa ilk gün. Birden çok
 * program varsa en son çalışılan. Program yoksa en uzun süredir yapılmayan
 * rutin; hiç yapılmamışlar önce (eklenme sırasıyla). Rutin yoksa null.
 */
export function pickNextRoutine(
  candidates: readonly RoutineCandidate[],
  links: readonly RoutineLinkLike[] = []
): NextRoutinePick | null {
  if (candidates.length === 0) return null;
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // Programlar: yalnızca hâlâ duran rutinler, gün sırasıyla
  const programs = new Map<string, RoutineLinkLike[]>();
  for (const link of links) {
    if (!byId.has(link.routineId)) continue;
    const days = programs.get(link.programId) ?? [];
    if (!days.some((d) => d.routineId === link.routineId)) days.push(link);
    programs.set(link.programId, days);
  }

  if (programs.size > 0) {
    let chosen: RoutineLinkLike[] | null = null;
    let chosenLast: string | null = null;
    for (const days of programs.values()) {
      const last = days.reduce<string | null>((acc, d) => laterIso(acc, byId.get(d.routineId)!.lastDoneAt), null);
      if (chosen == null || (last != null && (chosenLast == null || last > chosenLast))) {
        chosen = days;
        chosenLast = last;
      }
    }
    const days = [...chosen!].sort((a, b) => a.dayIndex - b.dayIndex);
    let lastIdx = -1;
    let lastAt: string | null = null;
    days.forEach((d, i) => {
      const at = byId.get(d.routineId)!.lastDoneAt;
      if (at != null && (lastAt == null || at > lastAt)) {
        lastAt = at;
        lastIdx = i;
      }
    });
    const nextIdx = (lastIdx + 1) % days.length;
    return { routineId: days[nextIdx]!.routineId, dayLabel: `Gün ${nextIdx + 1} / ${days.length}` };
  }

  const sorted = [...candidates].sort((a, b) => {
    if (a.lastDoneAt == null && b.lastDoneAt != null) return -1;
    if (a.lastDoneAt != null && b.lastDoneAt == null) return 1;
    if (a.lastDoneAt != null && b.lastDoneAt != null && a.lastDoneAt !== b.lastDoneAt) {
      return a.lastDoneAt < b.lastDoneAt ? -1 : 1;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.name.localeCompare(b.name, 'tr');
  });
  return { routineId: sorted[0]!.id, dayLabel: null };
}

// ── Rutin kartı satırı ──────────────────────────────────────────────────

export interface RoutineExerciseInfo {
  targetSets: number | null;
  restSeconds: number;
  primaryMuscles: string | null;
  category: string | null;
}

/** Rutin başlatılınca hedef yoksa açılan set sayısı (`startSession.ts`) */
const DEFAULT_SETS = 3;
const WORK_SECONDS_PER_SET = 40;
const WARMUP_MINUTES = 5;

/**
 * Süre tahmini (dk, 5'e yuvarlı): rutinde elle girilmiş süre varsa o;
 * yoksa ısınma + setler × (çalışma + dinlenme) — program önerisindeki
 * hesapla aynı (`sessionMinutes`).
 */
export function routineMinutes(list: readonly RoutineExerciseInfo[], estimated?: number | null): number {
  if (estimated != null && estimated > 0) return estimated;
  const seconds =
    WARMUP_MINUTES * 60 +
    list.reduce((sum, e) => sum + (e.targetSets ?? DEFAULT_SETS) * (WORK_SECONDS_PER_SET + e.restSeconds), 0);
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}

function parseMuscles(json: string | null): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

/** En çok set düşen ana kaslar (Türkçe ad, tekrar yok); kardiyo sayılmaz */
export function topMuscles(list: readonly RoutineExerciseInfo[], limit = 3): string[] {
  const score = new Map<string, number>();
  const order: string[] = [];
  for (const e of list) {
    if (e.category === 'cardio') continue;
    const muscles = parseMuscles(e.primaryMuscles);
    if (muscles.length === 0) continue;
    const share = (e.targetSets ?? DEFAULT_SETS) / muscles.length;
    for (const m of muscles) {
      const label = muscleLabel(m);
      if (!score.has(label)) order.push(label);
      score.set(label, (score.get(label) ?? 0) + share);
    }
  }
  return [...order].sort((a, b) => score.get(b)! - score.get(a)! || order.indexOf(a) - order.indexOf(b)).slice(0, limit);
}

/** "7 hareket · ~55 dk · Sırt, Hamstring, Kalça" */
export function routineSummaryLine(list: readonly RoutineExerciseInfo[], estimated?: number | null): string {
  const parts = [`${list.length} hareket`, `~${routineMinutes(list, estimated)} dk`];
  const muscles = topMuscles(list);
  if (muscles.length > 0) parts.push(muscles.join(', '));
  return parts.join(' · ');
}

export function routineColor(list: readonly RoutineExerciseInfo[]): BodyContext {
  return contextColorFor(
    list.map((e) => ({ primaryMuscles: e.primaryMuscles, category: e.category, sets: e.targetSets ?? DEFAULT_SETS }))
  );
}

/** "son: 4 gün önce" — takvim günü farkı; hiç yapılmadıysa null */
export function lastDoneText(lastDoneAt: string | null, now: Date): string | null {
  if (lastDoneAt == null) return null;
  const d = new Date(lastDoneAt);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return 'son: bugün';
  if (diff === 1) return 'son: dün';
  return `son: ${diff} gün önce`;
}

// ── Haftalık hacim ──────────────────────────────────────────────────────

export interface WeekVolumePair {
  thisWeek: number;
  lastWeek: number;
  /** "+%12" / "−%5"; geçen hafta 0 ise null */
  change: string | null;
}

/** Seans hacimleri (başlangıç ISO, kg) → bu hafta ve geçen hafta */
export function weekVolumePair(rows: readonly { date: string; volume: number }[], now: Date): WeekVolumePair {
  const thisStart = startOfWeek(now);
  const lastStart = new Date(thisStart.getFullYear(), thisStart.getMonth(), thisStart.getDate() - 7);
  let thisWeek = 0;
  let lastWeek = 0;
  for (const r of rows) {
    const t = new Date(r.date).getTime();
    if (t >= thisStart.getTime()) thisWeek += r.volume;
    else if (t >= lastStart.getTime()) lastWeek += r.volume;
  }
  let change: string | null = null;
  if (lastWeek > 0) {
    const pct = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
    change = pct >= 0 ? `+%${pct}` : `−%${Math.abs(pct)}`;
  }
  return { thisWeek, lastWeek, change };
}

// ── Son rekor ───────────────────────────────────────────────────────────

export interface RecordHistoryRow extends SessionSet {
  exerciseId: string;
  exerciseName: string;
  sessionId: string;
  sessionStartedAt: string;
}

export interface LatestRecord {
  exerciseName: string;
  weightKg: number;
  reps: number;
  at: string;
}

/**
 * En son kırılan e1RM rekoru: seanslar kronolojik yürünür, her hareketin
 * önceki seanslardaki en iyisi baz; antrenman ekranındaki rozetle aynı kural
 * (`findSessionRecordSetIds`; ilk seans rekor sayılmaz). En yeni rekorlu
 * seansta birden çok varsa e1RM'i en büyük olan.
 */
export function latestRecord(rows: readonly RecordHistoryRow[]): LatestRecord | null {
  const sessionsInOrder = new Map<string, { startedAt: string; byExercise: Map<string, RecordHistoryRow[]> }>();
  const sortedRows = [...rows].sort((a, b) =>
    a.sessionStartedAt === b.sessionStartedAt ? 0 : a.sessionStartedAt < b.sessionStartedAt ? -1 : 1
  );
  for (const r of sortedRows) {
    let s = sessionsInOrder.get(r.sessionId);
    if (!s) {
      s = { startedAt: r.sessionStartedAt, byExercise: new Map() };
      sessionsInOrder.set(r.sessionId, s);
    }
    const list = s.byExercise.get(r.exerciseId) ?? [];
    list.push(r);
    s.byExercise.set(r.exerciseId, list);
  }

  const best = new Map<string, number>();
  let latest: (LatestRecord & { e1rm: number }) | null = null;
  for (const s of sessionsInOrder.values()) {
    let sessionBest: (LatestRecord & { e1rm: number }) | null = null;
    for (const [exerciseId, list] of s.byExercise) {
      const prev = best.get(exerciseId) ?? null;
      const ids = findSessionRecordSetIds(list, prev);
      for (const r of list) {
        if (!ids.has(r.id)) continue;
        const e1rm = epley(r.weightKg, r.reps)!;
        if (sessionBest == null || e1rm > sessionBest.e1rm) {
          sessionBest = { exerciseName: r.exerciseName, weightKg: r.weightKg!, reps: r.reps!, at: s.startedAt, e1rm };
        }
      }
      let top = prev;
      for (const r of list) {
        if (!r.isCompleted || r.setType !== 'normal') continue;
        const e = epley(r.weightKg, r.reps);
        if (e != null && (top == null || e > top)) top = e;
      }
      if (top != null) best.set(exerciseId, top);
    }
    if (sessionBest) latest = sessionBest;
  }
  if (!latest) return null;
  return { exerciseName: latest.exerciseName, weightKg: latest.weightKg, reps: latest.reps, at: latest.at };
}

// ── Okuma ───────────────────────────────────────────────────────────────

export interface NextRoutineCard {
  routineId: string;
  name: string;
  dayLabel: string | null;
  line: string;
  lastDone: string | null;
  color: BodyContext;
}

export interface TodayData {
  /** null: hiç (dolu) rutin yok */
  next: NextRoutineCard | null;
  volume: WeekVolumePair;
  record: LatestRecord | null;
}

export async function loadTodayData(db: Db, now: Date, links: readonly RoutineLinkLike[] = []): Promise<TodayData> {
  // Rutinler (arşivlenmemiş, en az bir hareketli) ve son yapılma zamanları
  const routineRows = await db
    .select({ id: routines.id, name: routines.name, createdAt: routines.createdAt, n: count(routineExercises.id) })
    .from(routines)
    .leftJoin(routineExercises, eq(routineExercises.routineId, routines.id))
    .where(eq(routines.isArchived, false))
    .groupBy(routines.id);
  const lastRows = await db
    .select({ routineId: workoutSessions.routineId, last: max(workoutSessions.startedAt) })
    .from(workoutSessions)
    .where(and(isNotNull(workoutSessions.endedAt), isNotNull(workoutSessions.routineId)))
    .groupBy(workoutSessions.routineId);
  const lastBy = new Map(lastRows.map((r) => [r.routineId!, r.last ?? null]));
  const candidates: RoutineCandidate[] = routineRows
    .filter((r) => r.n > 0)
    .map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, lastDoneAt: lastBy.get(r.id) ?? null }));

  let next: NextRoutineCard | null = null;
  const pick = pickNextRoutine(candidates, links);
  if (pick) {
    const routine = (await db.select().from(routines).where(eq(routines.id, pick.routineId)).limit(1))[0]!;
    const list = await db
      .select({
        targetSets: routineExercises.targetSets,
        restSeconds: routineExercises.restSeconds,
        primaryMuscles: exercises.primaryMuscles,
        category: exercises.category,
      })
      .from(routineExercises)
      .innerJoin(exercises, eq(routineExercises.exerciseId, exercises.id))
      .where(eq(routineExercises.routineId, pick.routineId))
      .orderBy(asc(routineExercises.orderIndex));
    next = {
      routineId: routine.id,
      name: routine.name,
      dayLabel: pick.dayLabel,
      line: routineSummaryLine(list, routine.estimatedDurationMin),
      lastDone: lastDoneText(lastBy.get(routine.id) ?? null, now),
      color: routineColor(list),
    };
  }

  // Hacim: geçen haftanın Pazartesi'sinden bu yana
  const thisMonday = startOfWeek(now);
  const since = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7).toISOString();
  const volume = weekVolumePair(await sessionVolumesQuery(db, since), now);

  // Rekor: bütün bitmiş antrenmanların normal tamamlanmış setleri
  const recordRows = await db
    .select({
      id: sets.id,
      setNumber: sets.setNumber,
      setType: sets.setType,
      weightKg: sets.weightKg,
      reps: sets.reps,
      isCompleted: sets.isCompleted,
      completedAt: sets.completedAt,
      exerciseId: exercises.id,
      name: exercises.name,
      nameTr: exercises.nameTr,
      sessionId: workoutSessions.id,
      sessionStartedAt: workoutSessions.startedAt,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
    .where(and(isNotNull(workoutSessions.endedAt), eq(sets.isCompleted, true), eq(sets.setType, 'normal')));
  const record = latestRecord(
    recordRows.map((r) => ({
      ...r,
      exerciseName: exerciseDisplayName({ id: r.exerciseId, name: r.name, nameTr: r.nameTr }),
    }))
  );

  return { next, volume, record };
}
