import { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';

import { useDb } from '@/hooks/useDb';
import { EXERCISE_IMAGE_CACHE } from '@/lib/exerciseImage';
import { createSessionFromRoutine, sessionExerciseImageUrls } from '@/lib/startSession';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';

/**
 * Rutinden antrenman başlatma (Antrenman sekmesi ve ana sayfa "Sıradaki"
 * kartı). v4.0a'da `app/(tabs)/workout.tsx`'ten taşındı; adımlar aynı.
 */
export function useStartRoutine(): { start: (routine: { id: string; name: string }) => Promise<void>; starting: boolean } {
  const db = useDb();
  const router = useRouter();
  const startSession = useActiveWorkoutStore((s) => s.startSession);
  const [starting, setStarting] = useState(false);

  const start = async (routine: { id: string; name: string }) => {
    if (starting) return;
    setStarting(true);
    try {
      const sessionId = await createSessionFromRoutine(db, routine);

      if (sessionId == null) {
        Alert.alert('Boş Rutin', 'Bu rutin egzersiz içermiyor. Önce egzersiz ekle.');
        return;
      }

      startSession(sessionId);
      router.push('/session/active');

      // Hareket görsellerini arka planda önbelleğe al; salonda internet
      // olmasa da detayda görünsünler. Beklenmiyor, hata antrenmanı etkilemez.
      sessionExerciseImageUrls(db, sessionId)
        .then((urls) => (urls.length > 0 ? Image.prefetch(urls, EXERCISE_IMAGE_CACHE) : true))
        .catch((err) => console.warn('[IMAGE-PREFETCH] Atlandı:', err));
    } catch (err) {
      console.error('Antrenman başlatılırken hata:', err);
      Alert.alert('Hata', String(err));
    } finally {
      setStarting(false);
    }
  };

  return { start, starting };
}
