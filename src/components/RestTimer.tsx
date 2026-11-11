import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';
import { Maximize2, Minus, Plus, X, type LucideIcon } from 'lucide-react-native';

import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import { useColors } from '@/hooks/useTheme';
import {
  FALLBACK_REST_SOUND,
  FALLBACK_REST_VIBRATE,
  useAppSettings,
} from '@/hooks/useAppSettings';
import { shouldPlayRestSound } from '@/lib/restSound';
import { playRestDoneSound, preloadRestDoneSound } from '@/lib/restNative';

/**
 * Aktif antrenmanın dinlenme zamanlayıcısı.
 *
 * v4.0a: zamanlama ve bitiş davranışı `useRestTimerController`'da (kod
 * değişmedi, yalnızca bileşenden kancaya taşındı); `app/session/active.tsx`
 * bir kez bağlar. Görünüm iki türlü: tam ekran dinlenme
 * (`RestScreen.tsx`, odak modu) ve bu dosyadaki alt çubuk (`RestTimerBar`,
 * küçültülünce ve tüm listede).
 *
 * Sıfıra ulaştığında:
 * - Ayarlardaki "dinlenme bitiminde titreşim" açıksa haptic notification
 *   çalar (Android'de titreşim)
 * - "Dinlenme bitiminde ses" açıksa ve uygulama ön plandaysa kısa bip
 *   (telefon kilitliyken bitişi `restNative.ts`'teki bildirim haber veriyor)
 * - "Dinlenme tamamlandı" uyarısı 3 saniye görünür kalır
 *
 * Kullanıcı sürebilir: +/- 15 saniye, manuel iptal.
 *
 * Render düzeni: geri sayım ve ilerleme göstergesi kendi zamanlayıcılarıyla
 * saniyede bir yenilenen küçük bileşenler; kanca ve düğmeler yalnızca
 * sayaç değişince (başlatma, +/-, bitiş) render ediliyor.
 */
export interface RestTimerController {
  restTimer: { startedAt: number; durationSeconds: number } | null;
  completed: boolean;
  decrease: () => void;
  increase: () => void;
  stop: () => void;
}

export function useRestTimerController(): RestTimerController {
  const restTimer = useActiveWorkoutStore((s) => s.restTimer);
  const stopRestTimer = useActiveWorkoutStore((s) => s.stopRestTimer);
  const adjustRestTimer = useActiveWorkoutStore((s) => s.adjustRestTimer);

  const { settings } = useAppSettings();
  const vibrate = settings?.restTimerVibrate ?? FALLBACK_REST_VIBRATE;
  // Bitiş zamanlayıcısı ayar değişince yeniden kurulmasın diye ref
  const vibrateRef = useRef(vibrate);
  vibrateRef.current = vibrate;
  const sound = settings?.restTimerSound ?? FALLBACK_REST_SOUND;
  const soundRef = useRef(sound);
  soundRef.current = sound;

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

    const endAt = restTimer.startedAt + restTimer.durationSeconds * 1000;

    const complete = () => {
      setCompleted(true);
      // Bitiş haptic'i — kullanıcı titreşimi kapattıysa atlanır
      if (vibrateRef.current) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // Bitiş sesi — titreşimden bağımsız ayar; arka planda ve geç
      // kalmış bitişte çalmaz (bkz. shouldPlayRestSound)
      if (
        shouldPlayRestSound({
          enabled: soundRef.current,
          foreground: AppState.currentState === 'active',
          remainingMs: endAt - Date.now(),
        })
      ) {
        playRestDoneSound();
      }
    };

    const remainingMs =
      restTimer.startedAt + restTimer.durationSeconds * 1000 - Date.now();
    if (remainingMs <= 0) {
      complete();
      return;
    }

    // Ses dosyası bitişten önce yüklensin, ilk bip gecikmesin
    if (soundRef.current) preloadRestDoneSound();

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

  return { restTimer, completed, decrease, increase, stop: stopRestTimer };
}

/**
 * Alt çubuk: küçültülmüş dinlenme (odak modu) ve tüm liste. `onExpand`
 * verilirse sayaca dokununca tam ekran dinlenme açılır.
 */
export function RestTimerBar({
  controller,
  onExpand,
}: {
  controller: RestTimerController;
  onExpand?: () => void;
}) {
  const COLORS = useColors();
  const { restTimer, completed, decrease, increase, stop } = controller;
  if (!restTimer) return null;

  return (
    <View
      className={`border-t px-4 pt-2 pb-4 ${
        completed ? 'bg-ctx-rest border-ctx-rest' : 'bg-bg-surface border-border'
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

        <Pressable
          onPress={onExpand}
          disabled={!onExpand}
          accessibilityRole={onExpand ? 'button' : undefined}
          accessibilityLabel={onExpand ? 'Dinlenme ekranını aç' : undefined}
          className="flex-1 items-center min-h-[44px] justify-center active:opacity-70"
        >
          {completed ? (
            <Text className="text-ctx-fg font-display text-xl">Dinlenme tamam ✓</Text>
          ) : (
            <View className="flex-row items-center gap-2">
              <TimerCountdown
                startedAt={restTimer.startedAt}
                durationSeconds={restTimer.durationSeconds}
              />
              {onExpand && <Maximize2 color={COLORS.muted} size={16} />}
            </View>
          )}
        </Pressable>

        <TimerButton
          icon={Plus}
          label="15 saniye artır"
          onPress={increase}
          completed={completed}
        />

        <TimerButton
          icon={X}
          label="Dinlenmeyi bitir"
          onPress={stop}
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
export function useElapsedMs(startedAt: number): number {
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
        completed ? 'bg-ctx-fg/20' : 'bg-bg-elevated'
      }`}
    >
      <View
        className={`h-full ${completed ? 'bg-ctx-fg' : 'bg-ctx-rest'}`}
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
    <View className="items-center">
      <Text className="text-fg font-display text-4xl">
        {minutes}:{seconds.toString().padStart(2, '0')}
      </Text>
      <Text className="text-muted text-xs tracking-wide tabular-nums">
        {durationSeconds}sn dinlenme
      </Text>
    </View>
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
  const COLORS = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`w-12 h-12 rounded-[14px] items-center justify-center ${
        completed
          ? 'bg-ctx-fg/10 active:bg-ctx-fg/20'
          : 'bg-bg-elevated active:bg-border'
      } ${className}`}
    >
      <Icon color={completed ? COLORS.onContext : COLORS.text} size={20} />
    </Pressable>
  );
});
