import { useEffect, useState } from 'react';
import { inArray } from 'drizzle-orm';

import { exercises } from '@/db/schema';
import { useDb } from '@/hooks/useDb';

export interface ExerciseInfo {
  id: string;
  /** Türkçe ad, yoksa İngilizce */
  name: string;
  imagePaths: string | null;
  category: string;
  isCustom: boolean;
}

/**
 * Kimliklerden cihazdaki kütüphane bilgisi (program ayrıntısı ve
 * editörü). Kütüphanede olmayan kimlik haritada yok. `loaded` false iken
 * "bulunamadı" uyarısı gösterilmesin.
 */
export function useExerciseLookup(ids: readonly string[]): { byId: Map<string, ExerciseInfo>; loaded: boolean } {
  const db = useDb();
  const key = [...new Set(ids)].sort().join('|');
  const [state, setState] = useState<{ key: string; byId: Map<string, ExerciseInfo> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split('|') : [];
    (async () => {
      const rows =
        list.length === 0
          ? []
          : await db
              .select({
                id: exercises.id,
                name: exercises.name,
                nameTr: exercises.nameTr,
                imagePaths: exercises.imagePaths,
                category: exercises.category,
                isCustom: exercises.isCustom,
              })
              .from(exercises)
              .where(inArray(exercises.id, list));
      if (cancelled) return;
      setState({
        key,
        byId: new Map(
          rows.map((r) => [
            r.id,
            { id: r.id, name: r.nameTr ?? r.name, imagePaths: r.imagePaths, category: r.category, isCustom: r.isCustom },
          ])
        ),
      });
    })().catch((e) => console.warn('[PROGRAMS] Egzersizler okunamadı:', e));
    return () => {
      cancelled = true;
    };
  }, [db, key]);

  return state?.key === key ? { byId: state.byId, loaded: true } : { byId: new Map(), loaded: false };
}
