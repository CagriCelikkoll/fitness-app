import { memo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useScreenTopInset } from '@/hooks/useSafeBottom';
import { Check, ChevronDown, Volume2, VolumeX } from 'lucide-react-native';

import { useElapsedMs, type RestTimerController } from '@/components/RestTimer';
import { Glow, IconButton, SectionLabel, TickRing } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { useColors, useContextTones } from '@/hooks/useTheme';
import { formatElapsed } from '@/lib/focusMode';
import { RIR_OPTIONS, rirLabel } from '@/lib/rir';
import { restRingLabel } from '@/lib/tickRing';
import type { ContextKind } from '@/theme';

/**
 * Dinlenme ekranı (v4.0a 2.3). Sayaç ve bitiş davranışı
 * `useRestTimerController`'da (değişmedi); bu bileşen yalnızca görünüm.
 * Zemin `bg`, ışık `rest`. Küçültülünce odak moduna dönülür, sayaç
 * alt çubukta devam eder.
 */

export interface RestLastSet {
  setId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  rir: number | null;
}

export interface RestNextCard {
  /** "SET 3 / 4" */
  setLabel: string;
  name: string;
  /** "70 × 8" */
  value: string;
  color: ContextKind;
}

interface RestScreenProps {
  controller: RestTimerController;
  /** Antrenmanın başlangıcı (ms) ve tamamlanma yüzdesi: "25:42 · %43" */
  workoutStartedAt: number;
  percent: number;
  soundOn: boolean;
  onToggleSound: () => void;
  onMinimize: () => void;
  lastSet: RestLastSet | null;
  onSelectRir: (setId: string, rir: number | null) => void;
  next: RestNextCard | null;
}

export function RestScreen({
  controller,
  workoutStartedAt,
  percent,
  soundOn,
  onToggleSound,
  onMinimize,
  lastSet,
  onSelectRir,
  next,
}: RestScreenProps) {
  const topInset = useScreenTopInset();
  const { restTimer, completed, decrease, increase, stop } = controller;
  if (!restTimer) return null;

  return (
    <View className="flex-1 bg-bg">
      <Glow color="rest" height={520} />
      <ScrollView
        contentContainerStyle={{ paddingTop: topInset + 8, paddingBottom: 24, flexGrow: 1 }}
        contentContainerClassName="px-4 items-center"
      >
        {/* Üst satır: küçült · süre · ses */}
        <View className="flex-row items-center justify-between self-stretch">
          <IconButton icon={ChevronDown} accessibilityLabel="Dinlenmeyi küçült" onPress={onMinimize} />
          <WorkoutClock startedAt={workoutStartedAt} percent={percent} />
          <IconButton
            icon={soundOn ? Volume2 : VolumeX}
            accessibilityLabel={soundOn ? 'Bitiş sesini kapat' : 'Bitiş sesini aç'}
            onPress={onToggleSound}
          />
        </View>

        <SectionLabel color="rest" className="mt-6">
          {completed ? 'Dinlenme tamam' : 'Dinlenme'}
        </SectionLabel>

        <View className="mt-3">
          <RestRing startedAt={restTimer.startedAt} durationSeconds={restTimer.durationSeconds} completed={completed} />
        </View>

        <View className="flex-row gap-2.5 mt-5">
          <RestButton label="−15 sn" a11y="15 saniye azalt" onPress={decrease} />
          <RestButton label="+15 sn" a11y="15 saniye artır" onPress={increase} />
          <RestButton label="Atla" a11y="Dinlenmeyi atla" onPress={stop} strong />
        </View>

        {lastSet && (
          <RirCard lastSet={lastSet} onSelect={(rir) => onSelectRir(lastSet.setId, rir)} />
        )}

        {next && <NextCard next={next} />}
      </ScrollView>
    </View>
  );
}

/** "25:42 · %43" — kendi saniyesiyle yenilenir */
export const WorkoutClock = memo(function WorkoutClock({
  startedAt,
  percent,
  size = 'md',
}: {
  startedAt: number;
  percent: number;
  size?: 'md' | 'sm';
}) {
  const elapsed = Math.floor(useElapsedMs(startedAt) / 1000);
  return (
    <Text
      className={`font-display text-fg ${size === 'md' ? 'text-lg' : 'text-base'}`}
      accessibilityLabel={`Geçen süre ${formatElapsed(elapsed)}, yüzde ${percent} tamamlandı`}
    >
      {formatElapsed(elapsed)} <Text className="text-muted font-display">· %{percent}</Text>
    </Text>
  );
});

const RestRing = memo(function RestRing({
  startedAt,
  durationSeconds,
  completed,
}: {
  startedAt: number;
  durationSeconds: number;
  completed: boolean;
}) {
  const elapsedSeconds = Math.floor(useElapsedMs(startedAt) / 1000);
  const remaining = completed ? 0 : Math.max(0, durationSeconds - elapsedSeconds);
  const progress = completed ? 1 : Math.min(1, elapsedSeconds / Math.max(1, durationSeconds));
  return (
    <TickRing
      progress={progress}
      size={270}
      tickLength={22}
      color="rest"
      accessibilityLabel={completed ? 'Dinlenme tamamlandı' : restRingLabel(remaining)}
    >
      <Text className="font-display text-fg text-[72px] leading-[80px]">{clock(remaining)}</Text>
      <Text className="text-muted text-sm">/ {clock(durationSeconds)}</Text>
    </TickRing>
  );
});

function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function RestButton({ label, a11y, onPress, strong = false }: { label: string; a11y: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      className={`w-[92px] h-[52px] rounded-2xl items-center justify-center active:opacity-80 ${
        strong ? 'bg-fg' : 'bg-bg-surface border border-border'
      }`}
    >
      <Text className={`text-[15px] font-bold ${strong ? 'text-bg' : 'text-fg'}`}>{label}</Text>
    </Pressable>
  );
}

/** "Set 2 nasıldı? · 70 kg × 8 · kaç tekrar daha yapabilirdin" — isteğe bağlı */
function RirCard({ lastSet, onSelect }: { lastSet: RestLastSet; onSelect: (rir: number | null) => void }) {
  const COLORS = useColors();
  const rest = useContextTones('rest');
  const selected = lastSet.rir == null ? null : rirLabel(lastSet.rir);
  return (
    <View className="self-stretch mt-5 rounded-3xl bg-bg-surface border border-border px-4 py-3.5 gap-2.5">
      <View className="flex-row items-center gap-2">
        <Check color={rest.ink} size={16} strokeWidth={2.5} />
        <Text className="text-fg text-[15px] font-bold flex-1">
          Set {lastSet.setNumber} nasıldı?{' '}
          <Text className="text-muted font-normal">
            · {String(lastSet.weightKg).replace('.', ',')} kg × {lastSet.reps}
          </Text>
        </Text>
      </View>
      <Text className="text-muted text-[13px]">Kaç tekrar daha yapabilirdin? (isteğe bağlı)</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Kalan tekrar (RIR)" className="flex-row gap-1.5">
        {RIR_OPTIONS.map((value) => {
          const label = rirLabel(value);
          const on = selected === label;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${label} tekrar daha`}
              onPress={() => onSelect(on ? null : value)}
              className={`flex-1 h-11 rounded-xl items-center justify-center active:opacity-80 ${
                on ? '' : 'bg-bg-elevated border border-border'
              }`}
              style={on ? { backgroundColor: rest.fill } : undefined}
            >
              <Text className="font-display text-[15px]" style={{ color: on ? rest.onFill : COLORS.text }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function NextCard({ next }: { next: RestNextCard }) {
  return (
    <View className="self-stretch mt-auto pt-5">
      <View
        accessible
        accessibilityLabel={`Sıradaki: ${next.setLabel.toLocaleLowerCase('tr-TR')}, ${next.name}, ${next.value}`}
        className="rounded-3xl bg-bg-surface border border-border px-4 py-3.5 flex-row items-center justify-between"
      >
        <View className="flex-1 pr-3 gap-1">
          <SectionLabel color={next.color}>{`Sıradaki · ${next.setLabel}`}</SectionLabel>
          <Text className="text-fg text-base font-bold" numberOfLines={1}>
            {next.name}
          </Text>
        </View>
        <Text className="font-display text-fg text-2xl">{next.value}</Text>
      </View>
    </View>
  );
}

