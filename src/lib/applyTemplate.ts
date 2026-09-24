import { routineExercises, routines } from '@/db/schema';
import type { Db } from '@/db/client';
import { newId } from '@/lib/id';
import {
  templateRoutineName,
  type WorkoutTemplate,
} from '@/lib/workoutTemplates';

/**
 * `taken` içinde yoksa adı olduğu gibi, varsa " (2)", " (3)" … ekleyerek
 * ilk boş adı döndürür.
 */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/**
 * Programı kullanıcının rutinlerine kopyalar: her gün bir rutin.
 *
 * Tamamı tek transaction — yarıda kalırsa programın yarısı eklenmiş
 * olmasın. Aynı adda rutin varsa üzerine yazılmaz, sonuna sayı eklenir.
 *
 * @returns oluşturulan rutin id'leri, gün sırasıyla
 */
export async function applyTemplate(
  db: Db,
  template: WorkoutTemplate
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ name: routines.name }).from(routines);
    const taken = new Set(existing.map((r) => r.name));

    const routineIds: string[] = [];
    for (const day of template.days) {
      const routineId = newId();
      const name = uniqueName(templateRoutineName(template, day), taken);
      taken.add(name);

      await tx.insert(routines).values({
        id: routineId,
        name,
        description: template.description,
      });

      if (day.exercises.length > 0) {
        await tx.insert(routineExercises).values(
          day.exercises.map((e, idx) => ({
            id: newId(),
            routineId,
            exerciseId: e.exerciseId,
            orderIndex: idx,
            targetSets: e.sets,
            targetReps: e.reps,
            restSeconds: e.restSeconds,
          }))
        );
      }

      routineIds.push(routineId);
    }
    return routineIds;
  });
}
