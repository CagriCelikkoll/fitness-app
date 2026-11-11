import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { routines } from '@/db/schema';
import { useDb } from '@/hooks/useDb';
import {
  groupRoutines,
  loadRoutineCards,
  type ProgramInput,
  type RoutineCardItem,
  type RoutineLinkInput,
} from '@/lib/routineCards';

/**
 * Rutin kartları ve program grupları (Rutinler sekmesi ve rutin kapağı aynı
 * kapağı göstersin diye tek yerden). Veri birkaç tablodan geliyor: odaklanınca
 * (hareket planı ve antrenman değişmiş olabilir) ve rutin tablosu değişince
 * (silme, kopyalama, eşitleme) yeniden okunur.
 */
export function useRoutineCards({
  links,
  programs,
}: {
  links: readonly RoutineLinkInput[];
  programs: readonly ProgramInput[];
}) {
  const db = useDb();
  const { updatedAt: routinesChangedAt } = useLiveQuery(db.select({ id: routines.id }).from(routines));
  const [routineList, setRoutineList] = useState<RoutineCardItem[] | null>(null);

  const loadSeq = useRef(0);
  const reload = useCallback(() => {
    const seq = ++loadSeq.current;
    loadRoutineCards(db, new Date())
      .then((rows) => {
        if (seq === loadSeq.current) setRoutineList(rows);
      })
      .catch((err) => console.error('[ROUTINES] Liste okunamadı:', err));
  }, [db]);

  useFocusEffect(reload);
  useEffect(() => {
    if (routinesChangedAt) reload();
  }, [routinesChangedAt, reload]);

  const groups = useMemo(
    () => (routineList ? groupRoutines(routineList, { links, programs }) : []),
    [routineList, links, programs]
  );

  return { routineList, groups };
}
