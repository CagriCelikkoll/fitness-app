import { eq, inArray } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { exercises, routineExercises, routines } from '@/db/schema';
import { uniqueName } from '@/lib/applyTemplate';
import { newId } from '@/lib/id';
import {
  planRoutines,
  programExerciseIds,
  programRoutineName,
  repsText,
  type GymProgram,
  type PlannedDay,
  type ProgramPayload,
  type ProgramRoutineLink,
  type RoutinePlan,
} from '@/lib/programs';

/**
 * Program → yerel rutinler (v3.6b). "Rutinlerime ekle" her gün için bir
 * rutin oluşturur; "Güncelle" bağlı rutinlerin egzersizlerini programın
 * yeni haliyle değiştirir. Rutin düzenlemedeki gibi routine_exercises
 * silinip yeniden yazılır, hepsi tek transaction; geçmiş antrenmanlar
 * session_exercises'te ayrı snapshot olduğu için etkilenmez.
 *
 * Kütüphanede bulunmayan egzersizler atlanır (`planRoutines`). Rutinle
 * program arasındaki bağ çağıranın sakladığı `ProgramRoutineLink` listesi.
 */

type ProgramSource = Pick<GymProgram, 'id' | 'name' | 'description' | 'authorName' | 'version'> & {
  payload: ProgramPayload;
};

async function knownIds(db: Db, payload: ProgramPayload): Promise<Set<string>> {
  const ids = programExerciseIds(payload);
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: exercises.id }).from(exercises).where(inArray(exercises.id, ids));
  return new Set(rows.map((r) => r.id));
}

function exerciseRows(routineId: string, day: PlannedDay) {
  return day.exercises.map((e, idx) => ({
    id: newId(),
    routineId,
    exerciseId: e.exerciseId,
    orderIndex: idx,
    targetSets: e.sets,
    targetReps: repsText(e.repsMin, e.repsMax),
    restSeconds: e.restSec,
    notes: e.notes,
  }));
}

/** Programı rutinlere kopyalar. Döner: yeni bağlar ve plan (atlanan uyarısı için) */
export async function addProgramRoutines(
  db: Db,
  program: ProgramSource
): Promise<{ links: ProgramRoutineLink[]; plan: RoutinePlan }> {
  const plan = planRoutines(program.payload, await knownIds(db, program.payload));
  const links = await db.transaction(async (tx) => {
    const existing = await tx.select({ name: routines.name }).from(routines);
    const taken = new Set(existing.map((r) => r.name));
    const out: ProgramRoutineLink[] = [];
    for (const day of plan.days) {
      const routineId = newId();
      const name = uniqueName(programRoutineName(program.name, day.name, program.authorName), taken);
      taken.add(name);
      await tx.insert(routines).values({ id: routineId, name, description: program.description.trim() || null });
      await tx.insert(routineExercises).values(exerciseRows(routineId, day));
      out.push({ routineId, programId: program.id, version: program.version, dayIndex: day.dayIndex });
    }
    return out;
  });
  return { links, plan };
}

/**
 * Bağlı rutinleri programın yeni haline getirir:
 * - aynı günün rutini: ad ve egzersizler yenilenir (rutin kimliği aynı)
 * - programdan kalkan günün rutini: dokunulmaz, bağı düşer
 * - rutini olmayan gün (yeni gün ya da kullanıcı silmiş): yeni rutin
 * Döner: bu programın yeni bağları (hepsi yeni sürümde).
 */
export async function updateProgramRoutines(
  db: Db,
  program: ProgramSource,
  links: readonly ProgramRoutineLink[]
): Promise<{ links: ProgramRoutineLink[]; plan: RoutinePlan }> {
  const plan = planRoutines(program.payload, await knownIds(db, program.payload));
  const mine = links.filter((l) => l.programId === program.id);
  const next = await db.transaction(async (tx) => {
    const existing = await tx.select({ id: routines.id, name: routines.name }).from(routines);
    const existingIds = new Set(existing.map((r) => r.id));
    const linkedIds = new Set(mine.map((l) => l.routineId));
    // Kendi rutinlerimizin eski adları yeniden kullanılabilir
    const taken = new Set(existing.filter((r) => !linkedIds.has(r.id)).map((r) => r.name));
    const now = new Date().toISOString();
    const out: ProgramRoutineLink[] = [];

    for (const day of plan.days) {
      const link = mine.find((l) => l.dayIndex === day.dayIndex && existingIds.has(l.routineId));
      const name = uniqueName(programRoutineName(program.name, day.name, program.authorName), taken);
      taken.add(name);
      if (link) {
        await tx
          .update(routines)
          .set({ name, description: program.description.trim() || null, updatedAt: now })
          .where(eq(routines.id, link.routineId));
        await tx.delete(routineExercises).where(eq(routineExercises.routineId, link.routineId));
        await tx.insert(routineExercises).values(exerciseRows(link.routineId, day));
        out.push({ ...link, version: program.version });
      } else {
        const routineId = newId();
        await tx.insert(routines).values({ id: routineId, name, description: program.description.trim() || null });
        await tx.insert(routineExercises).values(exerciseRows(routineId, day));
        out.push({ routineId, programId: program.id, version: program.version, dayIndex: day.dayIndex });
      }
    }
    return out;
  });
  return { links: next, plan };
}

/** Cihazdaki rutin kimlikleri (silinen rutinlerin bağlarını düşürmek için) */
export async function routineIdSet(db: Db): Promise<Set<string>> {
  const rows = await db.select({ id: routines.id }).from(routines);
  return new Set(rows.map((r) => r.id));
}
