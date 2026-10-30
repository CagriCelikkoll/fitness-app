/**
 * Egzersiz listesi sorgusunun koşulları — liste ekranı ve seçici modal
 * aynı mantığı kullansın, test de gerçek DB'ye karşı bunu doğrulasın.
 *
 * v3.8: ekranlar aramayı SQL'de değil `exerciseCatalog.ts`'te yapıyor
 * (Türkçe ad ve eş anlamlılar veritabanında yok); `search` boş kalıyor.
 */

import { and, asc, eq, like, ne, or, sql, type SQL } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { cardioSegments, exercises, routineExercises, sessionExercises } from '@/db/schema';
import type { ExerciseFilter } from '@/lib/exerciseTaxonomy';

export function exerciseListCondition(
  filter: ExerciseFilter,
  search = ''
): SQL | undefined {
  const conditions: SQL[] = [eq(exercises.isArchived, false)];

  if (filter.kind === 'category') {
    conditions.push(eq(exercises.category, filter.category));
  } else if (filter.kind === 'region') {
    // Koşu vb. "Bacak" altında kafa karıştırıyor; kardiyonun kendi çipi
    // var. Esneme hareketleri ise bölgeyle gerçekten ilgili, kalıyor.
    conditions.push(ne(exercises.category, 'cardio'));
    // primary_muscles JSON metin ('["chest","triceps"]'). Tırnaklar
    // kalıba dahil: yoksa bir kas adı başka birinin parçasıyla eşleşir.
    conditions.push(
      or(
        ...filter.region.muscles.map((m) =>
          like(exercises.primaryMuscles, `%"${m}"%`)
        )
      )!
    );
  }

  const term = search.trim();
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(like(exercises.name, pattern), like(exercises.nameTr, pattern))!
    );
  }

  return and(...conditions);
}

/**
 * Bölge seçiliyken önce güç hareketleri, sonra diğerleri; her grup kendi
 * içinde alfabetik. CASE yalnızca ORDER BY'da — select'e alias'lı alan
 * eklemiyoruz.
 */
export function exerciseListOrder(filter: ExerciseFilter): SQL[] {
  const byName = asc(exercises.name);
  if (filter.kind !== 'region') return [byName];
  return [
    sql`case when ${exercises.category} = 'strength' then 0 else 1 end`,
    byName,
  ];
}

/**
 * Kullanıcının rutinlerinde ya da geçmişinde (yarım antrenman dahil) geçen
 * egzersizler: extra olsalar da varsayılan listede görünürler (v3.8).
 */
export async function getUsedExerciseIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ id: routineExercises.exerciseId })
    .from(routineExercises)
    .union(db.select({ id: sessionExercises.exerciseId }).from(sessionExercises))
    .union(db.select({ id: cardioSegments.exerciseId }).from(cardioSegments));
  return new Set(rows.map((r) => r.id));
}
