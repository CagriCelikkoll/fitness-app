/**
 * Rutinler sekmesi (v4.0b Bölüm 4): kart verisi, program başlıkları altında
 * gruplama, kapak dağıtımı ve rutin kopyalama.
 *
 * Gruplamada veritabanına ya da eşitlemeye yeni alan girmedi:
 * - Salon / hoca programı: cihazdaki rutin ↔ program bağı (`programs.routineLinks`)
 * - Hazır program: rutinin kalıcı bağı yok (`applyTemplate.ts`); kopyalanırken
 *   verilen ad "PPL — İtme" biçiminde, gruba addan bakılır. Kullanıcı adı
 *   değiştirirse rutin "Rutinlerim"e geçer.
 */

import { and, asc, eq, isNotNull, max } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { exercises, routineExercises, routines, workoutSessions } from '@/db/schema';
import { uniqueName } from '@/lib/applyTemplate';
import type { BodyContext } from '@/lib/contextColor';
import { assignCovers, coverFor, type CoverKind, type WorkoutCover } from '@/lib/coverImage';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { decimalComma } from '@/lib/format';
import { newId } from '@/lib/id';
import { getLastSessionForExercise } from '@/lib/lastSession';
import {
  DEFAULT_SETS,
  lastDoneText,
  routineColor,
  routineCoverKind,
  routineMinutes,
  type RoutineExerciseInfo,
} from '@/lib/today';
import { upperTr } from '@/lib/typography';
import { WORKOUT_TEMPLATES, templateRoutineName, type WorkoutTemplate } from '@/lib/workoutTemplates';

export interface RoutineCardItem {
  id: string;
  name: string;
  description: string | null;
  exerciseCount: number;
  /** "7 hareket · ~55 dk · son: 3 gün önce" */
  line: string;
  /** Kapak ekranı: "7 hareket · ~55 dk · 22 set" */
  stats: string;
  color: BodyContext;
  kind: CoverKind;
}

const KIND_LABELS: Record<CoverKind, string> = {
  upper: 'Üst vücut',
  lower: 'Alt vücut',
  full: 'Full body',
  cardio: 'Kardiyo',
};

export function routineKindLabel(kind: CoverKind): string {
  return KIND_LABELS[kind];
}

export function routineCardLine(list: readonly RoutineExerciseInfo[], estimated: number | null, lastDone: string | null): string {
  const parts = [`${list.length} hareket`, `~${routineMinutes(list, estimated)} dk`];
  if (lastDone != null) parts.push(lastDone);
  return parts.join(' · ');
}

export function routineStatsLine(list: readonly RoutineExerciseInfo[], estimated: number | null): string {
  const setCount = list.reduce((sum, e) => sum + (e.targetSets ?? DEFAULT_SETS), 0);
  return `${list.length} hareket · ~${routineMinutes(list, estimated)} dk · ${setCount} set`;
}

/** Arşivlenmemiş bütün rutinler, ada göre */
export async function loadRoutineCards(db: Db, now: Date): Promise<RoutineCardItem[]> {
  const routineRows = await db
    .select({
      id: routines.id,
      name: routines.name,
      description: routines.description,
      estimated: routines.estimatedDurationMin,
    })
    .from(routines)
    .where(eq(routines.isArchived, false))
    .orderBy(asc(routines.name));

  const exerciseRows = await db
    .select({
      routineId: routineExercises.routineId,
      targetSets: routineExercises.targetSets,
      restSeconds: routineExercises.restSeconds,
      primaryMuscles: exercises.primaryMuscles,
      category: exercises.category,
    })
    .from(routineExercises)
    .innerJoin(exercises, eq(routineExercises.exerciseId, exercises.id))
    .orderBy(asc(routineExercises.orderIndex));
  const byRoutine = new Map<string, RoutineExerciseInfo[]>();
  for (const { routineId, ...info } of exerciseRows) {
    const list = byRoutine.get(routineId) ?? [];
    list.push(info);
    byRoutine.set(routineId, list);
  }

  const lastRows = await db
    .select({ routineId: workoutSessions.routineId, last: max(workoutSessions.startedAt) })
    .from(workoutSessions)
    .where(and(isNotNull(workoutSessions.endedAt), isNotNull(workoutSessions.routineId)))
    .groupBy(workoutSessions.routineId);
  const lastBy = new Map(lastRows.map((r) => [r.routineId!, r.last ?? null]));

  return routineRows.map((r) => {
    const list = byRoutine.get(r.id) ?? [];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      exerciseCount: list.length,
      line: routineCardLine(list, r.estimated, lastDoneText(lastBy.get(r.id) ?? null, now)),
      stats: routineStatsLine(list, r.estimated),
      color: routineColor(list),
      kind: routineCoverKind(list),
    };
  });
}

// ── Gruplama ────────────────────────────────────────────────────────────

export interface RoutineLinkInput {
  routineId: string;
  programId: string;
  dayIndex: number;
}

export interface ProgramInput {
  id: string;
  name: string;
  payload: { days: readonly unknown[] } | null;
}

export interface RoutineGroupMember<T> {
  item: T;
  cover: WorkoutCover;
  /** Programdaki gün (0'dan); "Rutinlerim"de null */
  dayIndex: number | null;
}

export interface RoutineGroup<T> {
  key: string;
  title: string;
  /** Programın gün sayısı; "Rutinlerim"de null */
  dayCount: number | null;
  members: RoutineGroupMember<T>[];
}

export const OWN_ROUTINES_TITLE = 'Rutinlerim';

/** Bir programın altında gruplanmak için en az bu kadar gün */
const MIN_GROUP_DAYS = 2;

/** Aynı programı iki kez ekleyince verilen " (2)" soneki */
const withoutCopySuffix = (name: string) => name.replace(/ \(\d+\)$/, '');

interface Draft<T> {
  key: string;
  title: string;
  dayCount: number;
  days: { item: T; dayIndex: number }[];
}

function linkedDrafts<T extends { id: string }>(
  pending: Map<string, T>,
  links: readonly RoutineLinkInput[],
  programs: readonly ProgramInput[]
): Draft<T>[] {
  const drafts: Draft<T>[] = [];
  for (const program of programs) {
    const days = links
      .filter((l) => l.programId === program.id && pending.has(l.routineId))
      .map((l) => ({ item: pending.get(l.routineId)!, dayIndex: l.dayIndex }));
    if (days.length === 0) continue;
    for (const d of days) pending.delete(d.item.id);
    drafts.push({
      key: `program:${program.id}`,
      title: program.name,
      dayCount: program.payload?.days.length ?? days.length,
      days,
    });
  }
  return drafts;
}

function templateMatches<T extends { id: string; name: string }>(pending: Map<string, T>, template: WorkoutTemplate) {
  const dayByName = new Map(template.days.map((day, i) => [templateRoutineName(template, day), i]));
  const days: { item: T; dayIndex: number }[] = [];
  for (const item of pending.values()) {
    const dayIndex = dayByName.get(withoutCopySuffix(item.name));
    if (dayIndex != null) days.push({ item, dayIndex });
  }
  return days;
}

/**
 * Kısa adı ve gün adları çakışan programlar olabilir: en çok gününü bulan
 * program önce alır, eşitlikte günlerinin daha büyük kısmı bulunan.
 */
function templateDrafts<T extends { id: string; name: string }>(
  pending: Map<string, T>,
  templates: readonly WorkoutTemplate[]
): Draft<T>[] {
  const drafts: Draft<T>[] = [];
  for (;;) {
    let best: { template: WorkoutTemplate; days: { item: T; dayIndex: number }[] } | null = null;
    for (const template of templates) {
      const days = templateMatches(pending, template);
      if (days.length < MIN_GROUP_DAYS) continue;
      const better =
        best == null ||
        days.length > best.days.length ||
        (days.length === best.days.length && days.length / template.dayCount > best.days.length / best.template.dayCount);
      if (better) best = { template, days };
    }
    if (best == null) return drafts;
    for (const d of best.days) pending.delete(d.item.id);
    drafts.push({
      key: `template:${best.template.id}`,
      title: best.template.name,
      dayCount: best.template.dayCount,
      days: best.days,
    });
  }
}

/**
 * Program grupları (ada göre) ve en altta "Rutinlerim". Aynı programın
 * günleri mümkünse farklı kapak alır; kendi rutinlerinin kapağı başka rutin
 * eklenince değişmesin diye tek tek seçilir.
 */
export function groupRoutines<T extends { id: string; name: string; kind: CoverKind }>(
  items: readonly T[],
  options: {
    links?: readonly RoutineLinkInput[];
    programs?: readonly ProgramInput[];
    templates?: readonly WorkoutTemplate[];
  } = {}
): RoutineGroup<T>[] {
  const { links = [], programs = [], templates = WORKOUT_TEMPLATES } = options;
  const pending = new Map(items.map((item) => [item.id, item]));

  const drafts = [...linkedDrafts(pending, links, programs), ...templateDrafts(pending, templates)];
  const groups: RoutineGroup<T>[] = drafts
    .sort((a, b) => a.title.localeCompare(b.title, 'tr'))
    .map((draft) => {
      const covers = assignCovers(draft.days.map((d) => ({ id: d.item.id, kind: d.item.kind })));
      return {
        key: draft.key,
        title: draft.title,
        dayCount: draft.dayCount,
        members: [...draft.days]
          .sort((a, b) => a.dayIndex - b.dayIndex || a.item.name.localeCompare(b.item.name, 'tr'))
          .map((d) => ({ item: d.item, dayIndex: d.dayIndex, cover: covers.get(d.item.id)! })),
      };
    });

  if (pending.size > 0) {
    groups.push({
      key: 'own',
      title: OWN_ROUTINES_TITLE,
      dayCount: null,
      members: [...pending.values()].map((item) => ({
        item,
        dayIndex: null,
        cover: coverFor(item.id, item.kind),
      })),
    });
  }
  return groups;
}

// ── Rutin kapağı (Bölüm 5) ──────────────────────────────────────────────

export function findRoutineInGroups<T extends { id: string }>(
  groups: readonly RoutineGroup<T>[],
  routineId: string
): { group: RoutineGroup<T>; member: RoutineGroupMember<T> } | null {
  for (const group of groups) {
    const member = group.members.find((m) => m.item.id === routineId);
    if (member) return { group, member };
  }
  return null;
}

/**
 * "4 GÜN · Upper / Lower · GÜN 1"; programda değilse "ÜST VÜCUT". Program adı
 * büyük harfe çevrilmez (Bölüm 1.5: "SPLİT" gibi yanlış çıkıyor).
 */
export function routineCoverLabel(kind: CoverKind, group: { dayCount: number | null; title: string }, dayIndex: number | null): string {
  if (group.dayCount == null || dayIndex == null) return upperTr(routineKindLabel(kind));
  return `${group.dayCount} GÜN · ${group.title} · GÜN ${dayIndex + 1}`;
}

export interface RoutineExercisePlan {
  targetSets: number | null;
  targetReps: string | null;
  targetDurationSeconds: number | null;
  targetDistanceKm: number | null;
  category: string | null;
}

/** "4 × 6–8 · son 80 kg"; kardiyoda "20 dk · 5 km" */
export function routineExerciseLine(plan: RoutineExercisePlan, lastWeightKg: number | null): string {
  if (plan.category === 'cardio') {
    const parts: string[] = [];
    if (plan.targetDurationSeconds != null) parts.push(`${Math.round(plan.targetDurationSeconds / 60)} dk`);
    if (plan.targetDistanceKm != null) parts.push(`${decimalComma(plan.targetDistanceKm)} km`);
    return parts.length > 0 ? parts.join(' · ') : 'Kardiyo';
  }
  const setCount = plan.targetSets ?? DEFAULT_SETS;
  const target = plan.targetReps ? `${setCount} × ${plan.targetReps.replace('-', '–')}` : `${setCount} set`;
  return lastWeightKg != null && lastWeightKg > 0 ? `${target} · son ${decimalComma(lastWeightKg)} kg` : target;
}

export interface RoutineExerciseRow {
  id: string;
  name: string;
  imagePaths: string | null;
  category: string | null;
  primaryMuscles: string | null;
  line: string;
}

/** Rutinin hareketleri; "son": son antrenmandaki en ağır tamamlanmış normal set */
export async function loadRoutineExercises(db: Db, routineId: string): Promise<RoutineExerciseRow[]> {
  const rows = await db
    .select({ plan: routineExercises, exercise: exercises })
    .from(routineExercises)
    .innerJoin(exercises, eq(routineExercises.exerciseId, exercises.id))
    .where(eq(routineExercises.routineId, routineId))
    .orderBy(asc(routineExercises.orderIndex));

  return Promise.all(
    rows.map(async ({ plan, exercise }) => {
      const last = await getLastSessionForExercise(db, exercise.id, null);
      const weights = (last?.sets ?? []).map((s) => s.weightKg ?? 0);
      const lastWeight = weights.length > 0 ? Math.max(...weights) : null;
      return {
        id: plan.id,
        name: exerciseDisplayName(exercise),
        imagePaths: exercise.imagePaths,
        category: exercise.category,
        primaryMuscles: exercise.primaryMuscles,
        line: routineExerciseLine({ ...plan, category: exercise.category }, lastWeight),
      };
    })
  );
}

// ── Kopyalama ───────────────────────────────────────────────────────────

/** Rutini ve hareket planını kopyalar, tek transaction. Döner: yeni rutin */
export async function duplicateRoutine(db: Db, routineId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(routines).where(eq(routines.id, routineId)).limit(1);
    if (!source) throw new Error('Rutin bulunamadı');

    const existing = await tx.select({ name: routines.name }).from(routines);
    const newRoutineId = newId();
    await tx.insert(routines).values({
      id: newRoutineId,
      name: uniqueName(`${source.name} (kopya)`, new Set(existing.map((r) => r.name))),
      description: source.description,
      color: source.color,
      estimatedDurationMin: source.estimatedDurationMin,
    });

    const plan = await tx
      .select()
      .from(routineExercises)
      .where(eq(routineExercises.routineId, routineId))
      .orderBy(asc(routineExercises.orderIndex));
    if (plan.length > 0) {
      await tx.insert(routineExercises).values(plan.map((row) => ({ ...row, id: newId(), routineId: newRoutineId })));
    }
    return newRoutineId;
  });
}
