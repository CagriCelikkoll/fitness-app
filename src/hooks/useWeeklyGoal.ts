import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import { getWeeklyGoal, setWeeklyGoal } from '@/lib/weeklyGoal';

/**
 * Haftalık hedef (kv-store). Değer canlı dinlenmiyor; ekran her odağa
 * geldiğinde yeniden okunuyor — Ayarlar'da değişen hedef ana sayfaya
 * dönünce görünsün.
 *
 * `loaded` ilk okuma dönmeden true olmaz; çağıran o ana kadar "hedef yok"
 * daveti göstermemeli.
 */
export function useWeeklyGoal(): {
  goal: number | null;
  loaded: boolean;
  setGoal: (days: number | null) => Promise<void>;
} {
  const [goal, setGoalState] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getWeeklyGoal(Storage)
        .then((g) => {
          if (!active) return;
          setGoalState(g);
          setLoaded(true);
        })
        .catch((err) => {
          console.error('[WEEKLY-GOAL] Okunamadı:', err);
          if (active) setLoaded(true);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  const setGoal = useCallback(async (days: number | null) => {
    setGoalState(days);
    try {
      await setWeeklyGoal(Storage, days);
    } catch (err) {
      console.error('[WEEKLY-GOAL] Kaydedilemedi:', err);
      Alert.alert('Kaydetme hatası', String(err));
    }
  }, []);

  return { goal, loaded, setGoal };
}
