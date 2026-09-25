import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Pause, Plus, Minus, X } from 'lucide-react-native';

import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import { FALLBACK_REST_VIBRATE, useAppSettings } from '@/hooks/useAppSettings';
import { COLORS } from '@/theme';

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
  const adjustRestTimer = useActiveWorkoutStore((s) => s.adjustRestTimer);

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

  // Süre hâlâ dolmamışsa "tamamlandı" durumundan çık: bitmiş sayaç +15
  // ile canlandığında 3 sn'lik otomatik kapanma onu kapatmasın.
  useEffect(() => {
    if (!restTimer) return;
    const elapsed = Date.now() - restTimer.startedAt;
    if (elapsed < restTimer.durationSeconds * 1000) {
      setCompleted(false);
      setElapsedMs(elapsed);
    }
  }, [restTimer]);

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

  // Kalan süreyi kaydırır; sınırlar ve bitiş/canlanma store'da
  const adjustTimer = (deltaSeconds: number) => adjustRestTimer(deltaSeconds);

  // Bitişte bant kısa süreliğine limon dolguya döner (3 sn sonra kapanıyor)
  const iconColor = completed ? COLORS.accentFg : COLORS.text;
  const roundButton = `w-12 h-12 rounded-full items-center justify-center ${
    completed ? 'bg-accent-fg/10' : 'bg-bg-elevated active:bg-border'
  }`;

  return (
    <View
      className={`border-t px-4 pt-2 pb-4 ${
        completed ? 'bg-accent border-accent' : 'bg-bg-surface border-border'
      }`}
    >
      {/* Progress bar */}
      <View
        className={`h-[3px] rounded-full overflow-hidden mb-3 ${
          completed ? 'bg-accent-fg/20' : 'bg-bg-elevated'
        }`}
      >
        <View
          className={`h-full ${completed ? 'bg-accent-fg' : 'bg-accent'}`}
          style={{ width: `${progressPct}%` }}
        />
      </View>

      <View className="flex-row items-center justify-between">
        <Pressable onPress={() => adjustTimer(-15)} hitSlop={8}>
          <View className={roundButton}>
            <Minus color={iconColor} size={20} />
          </View>
        </Pressable>

        <View className="flex-1 items-center">
          {completed ? (
            <Text className="text-accent-fg font-bold text-2xl tracking-tight">
              Dinlenme tamam ✓
            </Text>
          ) : (
            <>
              <Text className="text-white text-5xl font-bold tabular-nums tracking-tight">
                {timeLabel}
              </Text>
              <Text className="text-muted text-xs tracking-wide tabular-nums">
                {restTimer.durationSeconds}sn dinlenme
              </Text>
            </>
          )}
        </View>

        <Pressable onPress={() => adjustTimer(15)} hitSlop={8}>
          <View className={roundButton}>
            <Plus color={iconColor} size={20} />
          </View>
        </Pressable>

        <Pressable onPress={stopRestTimer} hitSlop={8} className="ml-2">
          <View className={roundButton}>
            <X color={iconColor} size={20} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}
