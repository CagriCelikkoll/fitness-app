/**
 * Rekor sayfası (v4.0b Bölüm 7): antrenmanda rekor kırıldıysa özetten önce.
 * Ayrı route değil, özet ekranının ilk görünümü (`active.tsx` değişmedi).
 * Fotoğraf koyu olduğu için açık temada da koyu.
 */

import { ScrollView, useWindowDimensions, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Trophy, X } from 'lucide-react-native';

import { CoverImage } from '@/components/CoverImage';
import { IconButton, PrimaryButton } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { DarkSurface, useContextTones } from '@/hooks/useTheme';
import { formatDecimal } from '@/lib/format';
import {
  recordE1rmGain,
  recordHeadlineParts,
  recordMoreText,
  recordSetText,
  type RecordPageData,
} from '@/lib/recordEvents';
import { recordHeadlineSize } from '@/lib/typography';

/** Sayfa kenarları (24 + 24) */
const HEADLINE_INSET = 48;

export function RecordCelebration(props: { page: RecordPageData; onContinue: () => void }) {
  return (
    <DarkSurface className="flex-1">
      <StatusBar style="light" />
      <RecordCelebrationBody {...props} />
    </DarkSurface>
  );
}

function RecordCelebrationBody({ page, onContinue }: { page: RecordPageData; onContinue: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tones = useContextTones('record');
  const [weight, reps] = recordHeadlineParts(page);
  const fontSize = recordHeadlineSize(weight + reps, width - HEADLINE_INSET);
  const gain = recordE1rmGain(page);
  const more = recordMoreText(page.moreCount);

  return (
    <View className="flex-1 bg-bg">
      <CoverImage cover="rekor" variant="page" className="absolute left-0 right-0 top-0" style={{ height: '66%' }} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-4 gap-3.5"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: insets.top + 64 }}
      >
        <View className="flex-row self-start items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: tones.fill }}>
          <Trophy color={tones.onFill} size={16} />
          <Text className="text-xs font-bold tracking-widest" style={{ color: tones.onFill }}>
            YENİ REKOR
          </Text>
        </View>

        <View className="gap-1">
          <Text accessibilityRole="header" className="text-fg text-base font-bold" numberOfLines={2}>
            {page.exerciseName}
          </Text>
          <Text
            accessibilityLabel={`${formatDecimal(page.weightKg, 2)} kilogram, ${page.reps} tekrar`}
            className="font-display text-fg"
            numberOfLines={1}
            style={{ fontSize, lineHeight: Math.round(fontSize * 1.1) }}
          >
            {weight}
            <Text className="font-display" style={{ color: tones.ink }}>
              {reps}
            </Text>
          </Text>
          {more != null && (
            <Text className="text-sm font-semibold" style={{ color: tones.ink }}>
              {more}
            </Text>
          )}
        </View>

        <View className="flex-row gap-2.5">
          <View className="flex-1 rounded-2xl bg-bg-surface border border-border px-3.5 py-3 gap-0.5">
            <Text className="text-muted text-xs">Önceki en iyi</Text>
            <Text className="font-display text-fg text-lg">{recordSetText(page.previous)}</Text>
          </View>
          <View className="flex-1 rounded-2xl bg-bg-surface border border-border px-3.5 py-3 gap-0.5">
            <Text className="text-muted text-xs">Tahmini 1RM</Text>
            <Text className="font-display text-fg text-lg">
              {formatDecimal(page.e1rm)} kg
              {gain != null && (
                <Text className="font-display text-[13px]" style={{ color: tones.ink }}>
                  {` ${gain}`}
                </Text>
              )}
            </Text>
          </View>
        </View>

        <PrimaryButton label="Devam et" color="record" size="lg" className="mt-1" onPress={onContinue} />
      </ScrollView>

      <View pointerEvents="box-none" className="absolute right-4 top-0" style={{ paddingTop: insets.top + 8 }}>
        <IconButton icon={X} variant="ghost" iconSize={20} accessibilityLabel="Kapat" onPress={onContinue} className="bg-bg/60" />
      </View>
    </View>
  );
}
