/**
 * Hoca ve salon programları (v3.6b) — saf mantık + Supabase.
 * Sunucu: supabase/migrations/0011_programs.sql. Kuralları sunucu
 * uyguluyor; buradaki kontroller görünüm ve kaydetmeden önceki uyarı için.
 *
 * - Salon programı (`gym`): salonun bütün üyeleri okur.
 * - Öğrenci programı (`students`): yalnızca atanmış aktif öğrenciler.
 * - Üye programı "Rutinlerime ekle" ile kendi rutinlerine kopyalar
 *   (`programRoutines.ts`); rutin ile program arasındaki bağ ve sürüm
 *   cihazda (kv-store), program güncellenince rutin listesinde rozet.
 *
 * Payload sunucuda snake_case (`exercise_id`, `reps_min` …), uygulamada
 * camelCase. Fonksiyonlar fırlatmaz; React ve Expo bilmez;
 * test/programs.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult, GymMembership } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';
import type { KeyValueStore } from '@/lib/announcements';
import { canManageGym, canViewMembers } from '@/lib/gymAdmin';
import { dative, trainerTitle, type TrainerLink } from '@/lib/trainers';
import type { WorkoutTemplate } from '@/lib/workoutTemplates';

/** Sunucudaki program_payload_valid ve tablo kısıtlarıyla aynı */
export const PROGRAM_LIMITS = {
  nameMax: 60,
  descriptionMax: 500,
  daysMax: 7,
  dayNameMax: 40,
  exercisesMax: 20,
  setsMax: 10,
  repsMax: 100,
  restMax: 600,
  notesMax: 200,
} as const;

export const PROGRAM_SCHEMA = 1;

export type ProgramVisibility = 'gym' | 'students';

export interface ProgramExercise {
  exerciseId: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSec: number;
  notes: string | null;
}

export interface ProgramDay {
  name: string;
  exercises: ProgramExercise[];
}

export interface ProgramPayload {
  schema: typeof PROGRAM_SCHEMA;
  days: ProgramDay[];
}

export interface GymProgram {
  id: string;
  gymId: string;
  authorId: string | null;
  authorName: string | null;
  name: string;
  description: string;
  visibility: ProgramVisibility;
  /** null: tanımadığımız biçim (yeni şema) — uygulama güncellenmeli */
  payload: ProgramPayload | null;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  /** Bana atanmış (bağ aktif) ise atama zamanı */
  assignedAt: string | null;
}

export interface ProgramAssignment {
  id: string;
  programId: string;
  studentId: string;
  assignedAt: string | null;
}

// ============================================================================
// Ayrıştırma
// ============================================================================

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Sunucu payload'u (snake_case) → uygulama; tanımadığımız biçimse null */
export function parsePayload(raw: unknown): ProgramPayload | null {
  if (raw == null || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.schema !== PROGRAM_SCHEMA || !Array.isArray(p.days)) return null;
  const days: ProgramDay[] = [];
  for (const d of p.days as unknown[]) {
    const day = d as Record<string, unknown>;
    if (typeof day?.name !== 'string' || !Array.isArray(day.exercises)) return null;
    const exercises: ProgramExercise[] = [];
    for (const e of day.exercises as unknown[]) {
      const x = e as Record<string, unknown>;
      if (
        typeof x?.exercise_id !== 'string' ||
        !isInt(x.sets) ||
        !isInt(x.reps_min) ||
        !isInt(x.reps_max) ||
        !isInt(x.rest_sec)
      ) {
        return null;
      }
      exercises.push({
        exerciseId: x.exercise_id,
        sets: x.sets,
        repsMin: x.reps_min,
        repsMax: x.reps_max,
        restSec: x.rest_sec,
        notes: text(x.notes),
      });
    }
    days.push({ name: day.name, exercises });
  }
  return { schema: PROGRAM_SCHEMA, days };
}

/** Uygulama → sunucu payload'u (notlar kırpılır, boş not null) */
export function toServerPayload(p: ProgramPayload) {
  return {
    schema: PROGRAM_SCHEMA,
    days: p.days.map((d) => ({
      name: d.name.trim(),
      exercises: d.exercises.map((e) => ({
        exercise_id: e.exerciseId,
        sets: e.sets,
        reps_min: e.repsMin,
        reps_max: e.repsMax,
        rest_sec: e.restSec,
        notes: e.notes?.trim() ? e.notes.trim() : null,
      })),
    })),
  };
}

export function parseProgramRows(rows: unknown): GymProgram[] {
  if (!Array.isArray(rows)) return [];
  const out: GymProgram[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (
      typeof r?.id !== 'string' ||
      typeof r.gym_id !== 'string' ||
      typeof r.name !== 'string' ||
      (r.visibility !== 'gym' && r.visibility !== 'students') ||
      !isInt(r.version)
    ) {
      continue;
    }
    out.push({
      id: r.id,
      gymId: r.gym_id,
      authorId: text(r.author_id),
      authorName: text(r.author_name),
      name: r.name,
      description: typeof r.description === 'string' ? r.description : '',
      visibility: r.visibility,
      payload: parsePayload(r.payload),
      version: r.version,
      createdAt: text(r.created_at),
      updatedAt: text(r.updated_at),
      archivedAt: text(r.archived_at),
      assignedAt: text(r.assigned_at),
    });
  }
  return out;
}

export function parseAssignmentRows(rows: unknown): ProgramAssignment[] {
  if (!Array.isArray(rows)) return [];
  const out: ProgramAssignment[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.id !== 'string' || typeof r.program_id !== 'string' || typeof r.student_id !== 'string') continue;
    out.push({ id: r.id, programId: r.program_id, studentId: r.student_id, assignedAt: text(r.assigned_at) });
  }
  return out;
}

// ============================================================================
// Tekrar, dinlenme, doğrulama
// ============================================================================

/** 8,10 → "8-10"; 10,10 → "10" (rutindeki targetReps biçimi) */
export function repsText(min: number, max: number): string {
  return min === max ? String(min) : `${min}-${max}`;
}

/** "8-12" → {8, 12}; "10" → {10, 10}; "8-" → {8, 8}; geçersizse null */
export function parseRepRange(input: string): { min: number; max: number } | null {
  const m = /^\s*(\d{1,3})\s*(?:-\s*(\d{0,3}))?\s*$/.exec(input);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const max = m[2] ? parseInt(m[2], 10) : min;
  if (min < 1 || max > PROGRAM_LIMITS.repsMax || max < min) return null;
  return { min, max };
}

/** 90 → "90 sn"; 120 → "2 dk"; 150 → "2 dk 30 sn"; 0 → "Dinlenme yok" */
export function restText(sec: number): string {
  if (sec <= 0) return 'Dinlenme yok';
  if (sec < 60 || (sec < 120 && sec % 60 !== 0)) return `${sec} sn`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return rest === 0 ? `${min} dk` : `${min} dk ${rest} sn`;
}

/** "3 × 8-10" */
export function setsRepsText(e: Pick<ProgramExercise, 'sets' | 'repsMin' | 'repsMax'>): string {
  return `${e.sets} × ${repsText(e.repsMin, e.repsMax)}`;
}

const between = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;

/**
 * Kaydetmeden önce: sorun yoksa null, varsa kullanıcıya gösterilecek ilk
 * hata. Sunucu aynı sınırları ayrıca uyguluyor.
 */
export function validateProgram(input: { name: string; description: string; payload: ProgramPayload }): string | null {
  const L = PROGRAM_LIMITS;
  const name = input.name.trim();
  if (!name) return 'Programa bir ad ver.';
  if (name.length > L.nameMax) return `Ad en fazla ${L.nameMax} karakter olabilir.`;
  if (input.description.trim().length > L.descriptionMax) {
    return `Açıklama en fazla ${L.descriptionMax} karakter olabilir.`;
  }
  const days = input.payload.days;
  if (days.length === 0) return 'En az bir gün ekle.';
  if (days.length > L.daysMax) return `Bir programda en fazla ${L.daysMax} gün olabilir.`;
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const label = day.name.trim() || `${i + 1}. gün`;
    if (!day.name.trim()) return `${i + 1}. güne bir ad ver.`;
    if (day.name.trim().length > L.dayNameMax) return `Gün adı en fazla ${L.dayNameMax} karakter olabilir.`;
    if (day.exercises.length === 0) return `"${label}" gününe en az bir egzersiz ekle.`;
    if (day.exercises.length > L.exercisesMax) return `Bir günde en fazla ${L.exercisesMax} egzersiz olabilir.`;
    for (const e of day.exercises) {
      if (!between(e.sets, 1, L.setsMax)) return `"${label}": set sayısı 1–${L.setsMax} arasında olmalı.`;
      if (!between(e.repsMin, 1, L.repsMax) || !between(e.repsMax, e.repsMin, L.repsMax)) {
        return `"${label}": tekrar 1–${L.repsMax} arasında olmalı (ör. 8-12).`;
      }
      if (!between(e.restSec, 0, L.restMax)) return `"${label}": dinlenme 0–${L.restMax} sn arasında olmalı.`;
      if ((e.notes?.trim().length ?? 0) > L.notesMax) return `"${label}": not en fazla ${L.notesMax} karakter olabilir.`;
    }
  }
  return null;
}

// ============================================================================
// Hazır programdan başla
// ============================================================================

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Uygulamadaki hazır program (v1.1) → program taslağı */
export function templateToDraft(template: WorkoutTemplate): { name: string; description: string; payload: ProgramPayload } {
  return {
    name: template.name.slice(0, PROGRAM_LIMITS.nameMax),
    description: template.description.slice(0, PROGRAM_LIMITS.descriptionMax),
    payload: {
      schema: PROGRAM_SCHEMA,
      days: template.days.slice(0, PROGRAM_LIMITS.daysMax).map((d) => ({
        name: d.name.slice(0, PROGRAM_LIMITS.dayNameMax),
        exercises: d.exercises.slice(0, PROGRAM_LIMITS.exercisesMax).map((e) => {
          const reps = parseRepRange(e.reps) ?? { min: 10, max: 10 };
          return {
            exerciseId: e.exerciseId,
            sets: clamp(e.sets, 1, PROGRAM_LIMITS.setsMax),
            repsMin: reps.min,
            repsMax: reps.max,
            restSec: clamp(e.restSeconds, 0, PROGRAM_LIMITS.restMax),
            notes: null,
          };
        }),
      })),
    },
  };
}

// ============================================================================
// Rutinlerimden oluştur (v3.6e)
// ============================================================================

/** Hocanın cihazındaki bir rutin (yalnızca programa geçecek alanlar) */
export interface RoutineSource {
  name: string;
  exercises: {
    exerciseId: string;
    isCustom: boolean;
    targetSets: number | null;
    targetReps: string | null;
    restSeconds: number;
  }[];
}

/**
 * Seçilen rutinler → program taslağı: her rutin bir gün (adı rutinin adı).
 * Kişisel notlar programa geçmez. Kendi eklenen egzersizler üyelerin
 * kütüphanesinde olmadığı için atlanır, sayısı döner. Tek rutin seçildiyse
 * program adı rutinin adı; birden çoksa ad hocaya kalır.
 */
export function routinesToDraft(list: readonly RoutineSource[]): {
  name: string;
  description: string;
  payload: ProgramPayload;
  skippedCustom: number;
} {
  const L = PROGRAM_LIMITS;
  let skippedCustom = 0;
  const days = list.slice(0, L.daysMax).map((r, i) => {
    skippedCustom += r.exercises.filter((e) => e.isCustom).length;
    return {
      name: r.name.trim().slice(0, L.dayNameMax) || String.fromCharCode(65 + i),
      exercises: r.exercises
        .filter((e) => !e.isCustom)
        .slice(0, L.exercisesMax)
        .map((e) => {
          const parsed = parseRepRange(e.targetReps ?? '');
          const reps = parsed && parsed.max <= L.repsMax ? parsed : { min: 10, max: 10 };
          return {
            exerciseId: e.exerciseId,
            sets: clamp(e.targetSets ?? 3, 1, L.setsMax),
            repsMin: reps.min,
            repsMax: reps.max,
            restSec: clamp(e.restSeconds, 0, L.restMax),
            notes: null,
          };
        }),
    };
  });
  return {
    name: list.length === 1 ? list[0].name.trim().slice(0, L.nameMax) : '',
    description: '',
    payload: { schema: PROGRAM_SCHEMA, days },
    skippedCustom,
  };
}

// ============================================================================
// Program → yerel rutin planı
// ============================================================================

/** "Full Body – A · Duygu Hoca"; yazarın adı yoksa "Full Body – A" */
export function programRoutineName(programName: string, dayName: string, authorName: string | null): string {
  const base = `${programName.trim()} – ${dayName.trim()}`;
  return authorName?.trim() ? `${base} · ${trainerTitle(authorName)}` : base;
}

export interface PlannedDay {
  /** Programdaki gün sırası (0'dan) */
  dayIndex: number;
  name: string;
  exercises: ProgramExercise[];
}

export interface RoutinePlan {
  days: PlannedDay[];
  /** Kütüphanede bulunmadığı için atlanan egzersiz sayısı */
  skippedExercises: number;
  /** Bütün egzersizleri atlandığı için rutini oluşmayan günler */
  skippedDays: string[];
}

/** Kütüphanede (cihazda) bulunmayan egzersizler atlanır; boş kalan gün rutin olmaz */
export function planRoutines(payload: ProgramPayload, knownExerciseIds: ReadonlySet<string>): RoutinePlan {
  const days: PlannedDay[] = [];
  const skippedDays: string[] = [];
  let skippedExercises = 0;
  payload.days.forEach((day, dayIndex) => {
    const exercises = day.exercises.filter((e) => knownExerciseIds.has(e.exerciseId));
    skippedExercises += day.exercises.length - exercises.length;
    if (exercises.length === 0) skippedDays.push(day.name);
    else days.push({ dayIndex, name: day.name, exercises });
  });
  return { days, skippedExercises, skippedDays };
}

/** Atlanan egzersiz uyarısı; atlanan yoksa null */
export function skippedText(plan: Pick<RoutinePlan, 'skippedExercises' | 'skippedDays'>): string | null {
  if (plan.skippedExercises === 0) return null;
  const head = `${plan.skippedExercises} egzersiz bu uygulamanın kütüphanesinde bulunamadı ve atlandı.`;
  if (plan.skippedDays.length === 0) return head;
  return `${head} ${plan.skippedDays.map((d) => `"${d}"`).join(', ')} günü boş kaldığı için eklenmedi.`;
}

export function programExerciseIds(payload: ProgramPayload): string[] {
  return [...new Set(payload.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)))];
}

// ============================================================================
// Rutin ↔ program bağı (cihazda, kv-store)
// ============================================================================

export interface ProgramRoutineLink {
  routineId: string;
  programId: string;
  /** Rutine kopyalanan program sürümü */
  version: number;
  dayIndex: number;
}

export const ROUTINE_LINKS_KEY = 'programs.routineLinks';

export function parseRoutineLinks(raw: string | null): ProgramRoutineLink[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (l): l is ProgramRoutineLink =>
        typeof l?.routineId === 'string' &&
        typeof l.programId === 'string' &&
        isInt(l.version) &&
        isInt(l.dayIndex)
    );
  } catch {
    return [];
  }
}

export async function readRoutineLinks(store: KeyValueStore): Promise<ProgramRoutineLink[]> {
  try {
    return parseRoutineLinks(await store.getItem(ROUTINE_LINKS_KEY));
  } catch {
    return [];
  }
}

export async function writeRoutineLinks(store: KeyValueStore, links: readonly ProgramRoutineLink[]): Promise<void> {
  await store.setItem(ROUTINE_LINKS_KEY, JSON.stringify(links));
}

/** Silinmiş rutinlerin bağları düşer */
export function pruneLinks(links: readonly ProgramRoutineLink[], routineIds: ReadonlySet<string>): ProgramRoutineLink[] {
  return links.filter((l) => routineIds.has(l.routineId));
}

/** Bir programın bağlarını yenileriyle değiştir */
export function replaceProgramLinks(
  links: readonly ProgramRoutineLink[],
  programId: string,
  next: readonly ProgramRoutineLink[]
): ProgramRoutineLink[] {
  return [...links.filter((l) => l.programId !== programId), ...next];
}

/** "Böyle kalsın": rutinler aynı kalır, bu sürüm için rozet kalkar */
export function dismissUpdate(links: readonly ProgramRoutineLink[], programId: string, version: number): ProgramRoutineLink[] {
  return links.map((l) => (l.programId === programId ? { ...l, version } : l));
}

export interface ProgramUpdate {
  program: GymProgram;
  routineIds: string[];
}

/**
 * Rutine kopyalandıktan sonra güncellenmiş programlar. Yalnızca hâlâ
 * görebildiğim (listede olan, arşivlenmemiş, okunabilir) programlar.
 */
export function programUpdates(links: readonly ProgramRoutineLink[], programs: readonly GymProgram[]): ProgramUpdate[] {
  const out: ProgramUpdate[] = [];
  for (const program of programs) {
    if (program.archivedAt || !program.payload) continue;
    const mine = links.filter((l) => l.programId === program.id);
    if (mine.length === 0) continue;
    const copied = Math.max(...mine.map((l) => l.version));
    if (program.version > copied) out.push({ program, routineIds: mine.map((l) => l.routineId) });
  }
  return out;
}

/** Rozet metni: öğrenci programı → "Hocan programı güncelledi" */
export function updateBadgeText(program: Pick<GymProgram, 'visibility' | 'assignedAt'>): string {
  return program.assignedAt || program.visibility === 'students' ? 'Hocan programı güncelledi' : 'Salon programı güncellendi';
}

// ============================================================================
// Listeler ve yetki (görünüm)
// ============================================================================

const byDateDesc = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');

/** "Hocamın programları": bana atanmış olanlar, yeni atanan önce */
export function assignedPrograms(programs: readonly GymProgram[], gymId?: string): GymProgram[] {
  return programs
    .filter((p) => p.assignedAt != null && !p.archivedAt && (gymId == null || p.gymId === gymId))
    .sort((a, b) => byDateDesc(a.assignedAt, b.assignedAt));
}

/** "Salon programları": salona açık olanlar (bana ayrıca atanmışsa yukarıda) */
export function gymPrograms(programs: readonly GymProgram[], gymId?: string): GymProgram[] {
  return programs
    .filter((p) => p.visibility === 'gym' && p.assignedAt == null && !p.archivedAt && (gymId == null || p.gymId === gymId))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Bu kullanıcı programı düzenleyebilir / atayabilir mi: yönetici ya da (hoca olan) yazar */
export function canManageProgram(
  program: Pick<GymProgram, 'gymId' | 'authorId'>,
  userId: string | null,
  memberships: readonly Pick<GymMembership, 'gymId' | 'role'>[]
): boolean {
  if (!userId) return false;
  if (canManageGym(program.gymId, memberships)) return true;
  return program.authorId === userId && canViewMembers(program.gymId, memberships);
}

/** "Programlarım": hoca kendi programları, yönetici salondaki bütün programlar */
export function managedPrograms(
  programs: readonly GymProgram[],
  gymId: string,
  userId: string | null,
  memberships: readonly Pick<GymMembership, 'gymId' | 'role'>[]
): { active: GymProgram[]; archived: GymProgram[] } {
  const list = programs.filter((p) => p.gymId === gymId && canManageProgram(p, userId, memberships));
  const sorted = [...list].sort((a, b) => byDateDesc(a.updatedAt, b.updatedAt));
  return { active: sorted.filter((p) => !p.archivedAt), archived: sorted.filter((p) => p.archivedAt) };
}

/**
 * Öğrenciden programa atama (v3.6e): bu bağın hocasının yazdığı, benim
 * yönetebildiğim, arşivde olmayan programlar (sunucu yalnızca yazarın aktif
 * öğrencisine atamayı kabul ediyor). Atanmışlar ayrı; ikisi de en yeni üstte.
 */
export function studentProgramChoices(
  programs: readonly GymProgram[],
  assignments: readonly Pick<ProgramAssignment, 'programId' | 'studentId'>[],
  link: Pick<TrainerLink, 'gymId' | 'trainerId' | 'studentId'>,
  userId: string | null,
  memberships: readonly Pick<GymMembership, 'gymId' | 'role'>[]
): { assigned: GymProgram[]; available: GymProgram[] } {
  const candidates = programs
    .filter(
      (p) =>
        p.gymId === link.gymId && p.authorId === link.trainerId && !p.archivedAt && canManageProgram(p, userId, memberships)
    )
    .sort((a, b) => byDateDesc(a.updatedAt, b.updatedAt));
  const assignedIds = new Set(assignments.filter((a) => a.studentId === link.studentId).map((a) => a.programId));
  return {
    assigned: candidates.filter((p) => assignedIds.has(p.id)),
    available: candidates.filter((p) => !assignedIds.has(p.id)),
  };
}

/**
 * "Yalnızca öğrencilerim · 2 öğrenciye atandı": bağı hâlâ aktif olan
 * öğrencilere açık atamalar (bağı biten öğrenci programı görmüyor).
 */
export function assignedCount(
  program: Pick<GymProgram, 'id' | 'gymId' | 'authorId'>,
  assignments: readonly Pick<ProgramAssignment, 'programId' | 'studentId'>[],
  links: readonly Pick<TrainerLink, 'gymId' | 'trainerId' | 'studentId' | 'status'>[]
): number {
  return assignments.filter(
    (a) =>
      a.programId === program.id &&
      links.some(
        (l) => l.status === 'active' && l.gymId === program.gymId && l.trainerId === program.authorId && l.studentId === a.studentId
      )
  ).length;
}

/**
 * Atama sonrası onay: "Full Body, Ayşe'ye atandı. Ayşe'ye bildirim gitti."
 * Birden çok öğrencide sayı; adı girilmemiş tek öğrencide "öğrencine".
 */
export function assignedMessage(programName: string, studentNames: readonly (string | null)[]): string {
  const program = programName.trim();
  if (studentNames.length > 1) {
    return `${program}, ${studentNames.length} öğrenciye atandı. Öğrencilerine bildirim gitti.`;
  }
  const name = studentNames[0]?.trim();
  if (!name) return `${program}, öğrencine atandı. Öğrencine bildirim gitti.`;
  return `${program}, ${dative(name)} atandı. ${dative(name)} bildirim gitti.`;
}

export function visibilityLabel(v: ProgramVisibility): string {
  return v === 'gym' ? 'Salon programı' : 'Yalnızca öğrencilerim';
}

/** "2 gün · 11 egzersiz" */
export function programSummary(p: Pick<GymProgram, 'payload'>): string {
  if (!p.payload) return 'Görmek için uygulamayı güncelle';
  const ex = p.payload.days.reduce((n, d) => n + d.exercises.length, 0);
  return `${p.payload.days.length} gün · ${ex} egzersiz`;
}

// ============================================================================
// Önbellek (kv-store, kullanıcıya göre; çevrimdışı son liste)
// ============================================================================

export interface ProgramCache {
  fetchedAt: string;
  programs: GymProgram[];
}

export const programCacheKey = (userId: string) => `programs.cache.${userId}`;

export async function readProgramCache(store: KeyValueStore, userId: string): Promise<ProgramCache | null> {
  try {
    const raw = await store.getItem(programCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; rows?: unknown };
    if (typeof parsed.fetchedAt !== 'string' || !Array.isArray(parsed.rows)) return null;
    return { fetchedAt: parsed.fetchedAt, programs: parseProgramRows(parsed.rows) };
  } catch {
    return null;
  }
}

/** Sunucu satırları olduğu gibi saklanır; okurken aynı ayrıştırıcıdan geçer */
export async function writeProgramCache(store: KeyValueStore, userId: string, fetchedAt: string, rows: unknown[]): Promise<void> {
  await store.setItem(programCacheKey(userId), JSON.stringify({ fetchedAt, rows }));
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
    console.error('[PROGRAMS] HATA:', e);
    return err(e);
  }
}

/** Görebildiğim programlar; `rows` önbelleğe yazılmak için ham satırlar */
export function fetchPrograms(client: SupabaseClient | null, gymId: string | null = null) {
  return run<{ programs: GymProgram[]; rows: unknown[] }>(client, async (c) => {
    const { data, error } = await c.rpc('program_list', { p_gym_id: gymId });
    if (error) return err(error);
    const rows = Array.isArray(data) ? (data as unknown[]) : [];
    return ok({ programs: parseProgramRows(rows), rows });
  });
}

export interface ProgramInput {
  /** null: yeni program */
  id: string | null;
  gymId: string;
  name: string;
  description: string;
  visibility: ProgramVisibility;
  payload: ProgramPayload;
}

export function saveProgram(client: SupabaseClient | null, input: ProgramInput) {
  return run<string>(client, async (c) => {
    const { data, error } = await c.rpc('save_program', {
      p_id: input.id,
      p_gym_id: input.gymId,
      p_name: input.name.trim(),
      p_description: input.description.trim(),
      p_visibility: input.visibility,
      p_payload: toServerPayload(input.payload),
    });
    if (error) return err(error);
    return ok(String(data));
  });
}

export function setProgramArchived(client: SupabaseClient | null, programId: string, archived: boolean) {
  return run<null>(client, async (c) => {
    const { error } = await c.rpc('set_program_archived', { p_id: programId, p_archived: archived });
    return error ? err(error) : ok(null);
  });
}

/** Döner: yeni atanan öğrenci sayısı (zaten atanmışlar sayılmaz) */
export function assignProgram(client: SupabaseClient | null, programId: string, studentIds: readonly string[]) {
  return run<number>(client, async (c) => {
    const { data, error } = await c.rpc('assign_program', { p_program_id: programId, p_student_ids: [...studentIds] });
    if (error) return err(error);
    return ok(typeof data === 'number' ? data : 0);
  });
}

export function unassignProgram(client: SupabaseClient | null, programId: string, studentId: string) {
  return run<null>(client, async (c) => {
    const { error } = await c.rpc('unassign_program', { p_program_id: programId, p_student_id: studentId });
    return error ? err(error) : ok(null);
  });
}

/** Açık atamalar (hoca / yönetici bütün atamaları, öğrenci kendininkileri görür) */
export function fetchAssignments(client: SupabaseClient | null) {
  return run<ProgramAssignment[]>(client, async (c) => {
    const { data, error } = await c
      .from('program_assignments')
      .select('id, program_id, student_id, assigned_at')
      .is('removed_at', null)
      .order('assigned_at', { ascending: false })
      .limit(2000);
    if (error) return err(error);
    return ok(parseAssignmentRows(data));
  });
}
