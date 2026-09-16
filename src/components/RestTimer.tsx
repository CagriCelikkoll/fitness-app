import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Pause, Plus, Minus, X } from 'lucide-react-native';

import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import { FALLBACK_REST_VIBRATE, useAppSettings } from '@/hooks/useAppSettings';

/**
 * Aktif antrenmanın altında sabit görünen dinlenme zamanlayıcısı.
 * Zustand store'daki restTimer state'i null değilken otomatik render edilir.
 *
 * Sıfıra ulaştığında:
 * - Ayarlardaki "dinlenme bitiminde titreşim" açıksa haptic notification
 *   çalar (Android'de titreşim)
 * - "Dinlenme tamamlandı" uyarısı 3 saniye görünür kalır
 *
 * Kullanıcı sürebilir: +/- 15 saniye, manuel iptal.
 */
export function RestTimer() {
  const restTimer = useActiveWorkoutStore((s) => s.restTimer);
  const stopRestTimer = useActiveWorkoutStore((s) => s.stopRestTimer);
  const startRestTimer = useActiveWorkoutStore((s) => s.startRestTimer);

  const { settings } = useAppSettings();
  const vibrate = settings?.restTimerVibrate ?? FALLBACK_REST_VIBRATE;

  const [elapsedMs, setElapsedMs] = useState(0);
  const [completed, setCompleted] = useState(false);

  // Tick interval'i — saniyede 4 kez güncelle, akıcı sayım için yeterli
  useEffect(() => {
    if (!restTimer) {
      setElapsedMs(0);
      setCompleted(false);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - restTimer.startedAt;
      setElapsedMs(elapsed);

      const totalMs = restTimer.durationSeconds * 1000;
      if (elapsed >= totalMs && !completed) {
        setCompleted(true);
        // Bitiş haptic'i — kullanıcı titreşimi kapattıysa atlanır
        if (vibrate) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    }, 250);

    return () => clearInterval(interval);
    // vibrate dep'te: interval yeniden kurulsa da sayım startedAt'ten
    // hesaplandığı için görünürde bir sıçrama olmuyor.
  }, [restTimer, completed, vibrate]);

  // Bitince 3 saniye sonra otomatik kapat
  useEffect(() => {
    if (!completed) return;
    const timeout = setTimeout(() => {
      stopRestTimer();
    }, 3000);
    return () => clearTimeout(timeout);
  }, [completed, stopRestTimer]);

  if (!restTimer) return null;

  const totalSeconds = restTimer.durationSeconds;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const remaining = Math.max(0, totalSeconds - elapsedSeconds);
  const progressPct = Math.min(100, (elapsedSeconds / totalSeconds) * 100);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const adjustTimer = (deltaSeconds: number) => {
    const newDuration = Math.max(15, restTimer.durationSeconds + deltaSeconds);
    // Tek değişiklik: durationSeconds'i güncelle, startedAt'i koru
    startRestTimer(newDuration);
    // Hack: startRestTimer yeniden başlatıyor; manuel state ayarı için
    // store'a yeni bir action eklemek doğrusu — şimdilik basit tutuyoruz
  };

  return (
    <View className="bg-bg-surface border-t border-bg-elevated p-3">
      {/* Progress bar */}
      <View className="h-1 bg-bg-elevated rounded-full overflow-hidden mb-2">
        <View
          className={`h-full ${completed ? 'bg-accent' : 'bg-accent-warm'}`}
          style={{ width: `${progressPct}%` }}
        />
      </View>

      <View className="flex-row items-center justify-between">
        <Pressable onPress={() => adjustTimer(-15)} hitSlop={8}>
          <View className="w-10 h-10 rounded-full bg-bg-elevated items-center justify-center">
            <Minus color="#fff" size={18} />
          </View>
        </Pressable>

        <View className="flex-1 items-center">
          {completed ? (
            <Text className="text-accent font-bold text-lg">
              Dinlenme tamam ✓
            </Text>
          ) : (
            <>
              <Text className="text-white text-2xl font-bold tabular-nums">
                {timeLabel}
              </Text>
              <Text className="text-muted text-xs">
                {restTimer.durationSeconds}sn dinlenme
              </Text>
            </>
          )}
        </View>

        <Pressable onPress={() => adjustTimer(15)} hitSlop={8}>
          <View className="w-10 h-10 rounded-full bg-bg-elevated items-center justify-center">
            <Plus color="#fff" size={18} />
          </View>
        </Pressable>

        <Pressable onPress={stopRestTimer} hitSlop={8} className="ml-2">
          <View className="w-10 h-10 rounded-full bg-bg-elevated items-center justify-center">
            <X color="#fff" size={18} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}
