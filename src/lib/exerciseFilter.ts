/**
 * Egzersiz listesi sorgusunun koşulları — liste ekranı ve seçici modal
 * aynı mantığı kullansın, test de gerçek DB'ye karşı bunu doğrulasın.
 */

import { and, asc, eq, like, ne, or, sql, type SQL } from 'drizzle-orm';

import { exercises } from '@/db/schema';
import type { ExerciseFilter } from '@/lib/exerciseTaxonomy';

export function exerciseListCondition(
  filter: ExerciseFilter,
  search: string
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
