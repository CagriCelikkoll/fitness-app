import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Minus, Plus, X, type LucideIcon } from 'lucide-react-native';

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
 *
 * Render düzeni: geri sayım ve ilerleme çubuğu kendi zamanlayıcılarıyla
 * saniyede bir yenilenen küçük bileşenler; bu bileşen ve düğmeler yalnızca
 * sayaç değişince (başlatma, +/-, bitiş) render ediliyor.
 */
export function RestTimer() {
  const restTimer = useActiveWorkoutStore((s) => s.restTimer);
  const stopRestTimer = useActiveWorkoutStore((s) => s.stopRestTimer);
  const adjustRestTimer = useActiveWorkoutStore((s) => s.adjustRestTimer);

  const { settings } = useAppSettings();
  const vibrate = settings?.restTimerVibrate ?? FALLBACK_REST_VIBRATE;
  // Bitiş zamanlayıcısı ayar değişince yeniden kurulmasın diye ref
  const vibrateRef = useRef(vibrate);
  vibrateRef.current = vibrate;

  const [completed, setCompleted] = useState(false);

  // Bitiş anı tik aralığına bağlı değil: kalan süre kadar tek bir
  // zamanlayıcı. Sayaç her değiştiğinde (+/-, yeniden başlatma, bitmiş
  // sayacın +15 ile canlanması) yeniden kuruluyor; süre dolmamışsa
  // "tamamlandı" durumundan çıkılıyor ki 3 sn'lik otomatik kapanma
  // canlanan sayacı kapatmasın.
  useEffect(() => {
    if (!restTimer) {
      setCompleted(false);
      return;
    }

    const complete = () => {
      setCompleted(true);
      // Bitiş haptic'i — kullanıcı titreşimi kapattıysa atlanır
      if (vibrateRef.current) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    };

    const remainingMs =
      restTimer.startedAt + restTimer.durationSeconds * 1000 - Date.now();
    if (remainingMs <= 0) {
      complete();
      return;
    }

    setCompleted(false);
    const timeout = setTimeout(complete, remainingMs);
    return () => clearTimeout(timeout);
  }, [restTimer]);

  // Bitince 3 saniye sonra otomatik kapat
  useEffect(() => {
    if (!completed) return;
    const timeout = setTimeout(() => {
      stopRestTimer();
    }, 3000);
    return () => clearTimeout(timeout);
  }, [completed, stopRestTimer]);

  // Store action'ları sabit referans; düğmeler render'lar arasında
  // aynı callback'i alıyor
  const decrease = useCallback(() => adjustRestTimer(-15), [adjustRestTimer]);
  const increase = useCallback(() => adjustRestTimer(15), [adjustRestTimer]);

  if (!restTimer) return null;

  return (
    <View
      className={`border-t px-4 pt-2 pb-4 ${
        completed ? 'bg-accent border-accent' : 'bg-bg-surface border-border'
      }`}
    >
      <TimerProgress
        startedAt={restTimer.startedAt}
        durationSeconds={restTimer.durationSeconds}
        completed={completed}
      />

      <View className="flex-row items-center justify-between">
        <TimerButton
          icon={Minus}
          label="15 saniye azalt"
          onPress={decrease}
          completed={completed}
        />

        <View className="flex-1 items-center">
          {completed ? (
            <Text className="text-accent-fg font-bold text-2xl tracking-tight">
              Dinlenme tamam ✓
            </Text>
          ) : (
            <TimerCountdown
              startedAt={restTimer.startedAt}
              durationSeconds={restTimer.durationSeconds}
            />
          )}
        </View>

        <TimerButton
          icon={Plus}
          label="15 saniye artır"
          onPress={increase}
          completed={completed}
        />

        <TimerButton
          icon={X}
          label="Dinlenmeyi bitir"
          onPress={stopRestTimer}
          completed={completed}
          className="ml-2"
        />
      </View>
    </View>
  );
}

/**
 * startedAt'ten bu yana geçen ms; her tam saniye sınırında yenilenir.
 * Ekranda saniye gösterildiği için 250 ms'lik tik gereksizdi; sınıra
 * hizalı zamanlayıcı rakamın geç dönmesini de önlüyor.
 */
function useElapsedMs(startedAt: number): number {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      // Bir sonraki tam saniyeye kadar bekle (+5 ms: sınırın hemen ardı)
      timeout = setTimeout(tick, 1000 - (((elapsed % 1000) + 1000) % 1000) + 5);
    };
    tick();
    return () => clearTimeout(timeout);
  }, [startedAt]);

  return elapsedMs;
}

interface TimerDisplayProps {
  startedAt: number;
  durationSeconds: number;
}

const TimerProgress = memo(function TimerProgress({
  startedAt,
  durationSeconds,
  completed,
}: TimerDisplayProps & { completed: boolean }) {
  const elapsedSeconds = Math.floor(useElapsedMs(startedAt) / 1000);
  const progressPct = completed
    ? 100
    : Math.min(100, (elapsedSeconds / Math.max(durationSeconds, 1)) * 100);

  return (
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
  );
});

const TimerCountdown = memo(function TimerCountdown({
  startedAt,
  durationSeconds,
}: TimerDisplayProps) {
  const elapsedSeconds = Math.floor(useElapsedMs(startedAt) / 1000);
  const remaining = Math.max(0, durationSeconds - elapsedSeconds);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <>
      <Text className="text-white text-5xl font-bold tabular-nums tracking-tight">
        {minutes}:{seconds.toString().padStart(2, '0')}
      </Text>
      <Text className="text-muted text-xs tracking-wide tabular-nums">
        {durationSeconds}sn dinlenme
      </Text>
    </>
  );
});

/**
 * Yuvarlak 48×48 düğme. Basılı tonu (active:) doğrudan Pressable'da:
 * NativeWind, active: sınıfı taşıyan bir View'u kendi Pressable'ına
 * çeviriyor; iç içe gelince dokunuşu onPress'i olmayan içteki yutuyordu.
 */
const TimerButton = memo(function TimerButton({
  icon: Icon,
  label,
  onPress,
  completed,
  className = '',
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  completed: boolean;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`w-12 h-12 rounded-full items-center justify-center ${
        completed
          ? 'bg-accent-fg/10 active:bg-accent-fg/20'
          : 'bg-bg-elevated active:bg-border'
      } ${className}`}
    >
      <Icon color={completed ? COLORS.accentFg : COLORS.text} size={20} />
    </Pressable>
  );
});
