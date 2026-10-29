/**
 * Egzersiz listesi (Egzersizler sekmesi ve seçici, v3.8): filtre SQL'de,
 * arama / core-extra ayrımı / sıralama `exerciseCatalog.ts`'te.
 *
 * Kullanılan egzersizler (rutin, geçmiş) `refreshUsed` ile okunur: sekme
 * odaklanınca, seçici açılınca. `useLiveQuery` join'leri dinlemiyor.
 */

import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { useDb } from '@/hooks/useDb';
import { exercises, type Exercise } from '@/db/schema';
import { exerciseListCondition, exerciseListOrder, getUsedExerciseIds } from '@/lib/exerciseFilter';
import { EXERCISE_FILTER_OPTIONS } from '@/lib/exerciseTaxonomy';
import { buildExerciseListItems, partitionExercises } from '@/lib/exerciseCatalog';

export function useExerciseList({
  filterId,
  search,
  showExtra,
  /** Seçicide önceden seçili olanlar da core gibi görünsün */
  extraUsedIds,
}: {
  filterId: string;
  search: string;
  showExtra: boolean;
  extraUsedIds?: readonly string[];
}) {
  const db = useDb();

  const option = EXERCISE_FILTER_OPTIONS.find((o) => o.id === filterId) ?? EXERCISE_FILTER_OPTIONS[0]!;

  const query = useMemo(
    () =>
      db
        .select()
        .from(exercises)
        .where(exerciseListCondition(option.filter))
        .orderBy(...exerciseListOrder(option.filter)),
    [db, option]
  );
  const { data, error } = useLiveQuery(query, [filterId]);

  const [usedIds, setUsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const refreshUsed = useCallback(() => {
    getUsedExerciseIds(db)
      .then(setUsedIds)
      .catch((err) => console.error('[EXERCISES] Kullanılan egzersizler okunamadı:', err));
  }, [db]);

  const extraKey = extraUsedIds?.join(',') ?? '';
  const allUsed = useMemo(() => {
    if (!extraKey) return usedIds;
    return new Set([...usedIds, ...extraKey.split(',')]);
  }, [usedIds, extraKey]);

  const partition = useMemo(
    () =>
      data
        ? partitionExercises<Exercise>(data, {
            search,
            usedIds: allUsed,
            strengthFirst: option.filter.kind === 'region',
          })
        : null,
    [data, search, allUsed, option]
  );

  const items = useMemo(
    () =>
      partition
        ? buildExerciseListItems(partition, { searching: search.trim().length > 0, showExtra })
        : null,
    [partition, search, showExtra]
  );

  return { items, partition, error, refreshUsed };
}
