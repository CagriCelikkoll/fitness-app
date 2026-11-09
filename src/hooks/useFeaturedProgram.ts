import { useCallback, useState } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { useFocusEffect } from 'expo-router';

import { defaultFeaturedProgram, loadFeaturedProgram } from '@/lib/programCatalog';
import type { RecommendedProgram } from '@/lib/programRecommendation';

/** "Bana program öner"den dönünce kart yeni seçimle güncellensin */
export function useFeaturedProgram(): RecommendedProgram | null {
  const [program, setProgram] = useState<RecommendedProgram | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadFeaturedProgram(Storage)
        .catch((err) => {
          console.error('[TEMPLATE] Öneri okunamadı:', err);
          return defaultFeaturedProgram();
        })
        .then((next) => {
          if (!cancelled) setProgram(next);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );
  return program;
}
