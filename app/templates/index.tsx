/**
 * Hazır programlar (v4.0b Bölüm 6): öneri satırı, gün filtresi, önerilen büyük
 * kart ve iki sütunlu programlar. Fotoğraf koyu olduğu için kartlar açık
 * temada da koyu (Rutinler sekmesi gibi).
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Sparkles } from 'lucide-react-native';

import { CoverImage } from '@/components/CoverImage';
import { EntryRow } from '@/components/EntryRow';
import { Chip, DisplayName, IconButton, SectionLabel } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { useFeaturedProgram } from '@/hooks/useFeaturedProgram';
import { DarkSurface } from '@/hooks/useTheme';
import {
  DAY_FILTERS,
  programCatalogView,
  type DayFilter,
  type FeaturedCard,
  type ProgramCard,
} from '@/lib/programCatalog';
import { upperTr } from '@/lib/typography';

/** Sayfa kenarı (20 + 20) + kart içi (16 + 16) */
const FEATURED_NAME_INSET = 72;
const FEATURED_NAME_SIZES = [26, 24, 20] as const;
const GRID_NAME_SIZES = [17, 15, 13] as const;
const GRID_CARD_SHARE = 0.485;

/** İki sütunda kart genişliği ekrana bağlı; `DisplayName` boşluğu düşerek ölçüyor */
function gridNameInset(windowWidth: number): number {
  return windowWidth - ((windowWidth - 40) * GRID_CARD_SHARE - 24);
}

export default function TemplatesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<DayFilter>('all');
  const program = useFeaturedProgram();
  const view = useMemo(() => (program ? programCatalogView(filter, program) : null), [filter, program]);

  const open = (id: string) => router.push({ pathname: '/templates/[id]', params: { id } });

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 gap-3 pb-6">
      <View className="flex-row items-center gap-3" style={{ paddingTop: insets.top + 8 }}>
        <IconButton icon={ChevronLeft} iconSize={22} accessibilityLabel="Geri" onPress={() => router.back()} />
        <Text accessibilityRole="header" className="flex-1 font-display text-fg text-2xl leading-[30px]">
          {upperTr('Hazır programlar')}
        </Text>
      </View>

      <Link href="/templates/recommend" asChild>
        <EntryRow icon={Sparkles} label="Bana program öner" brand />
      </Link>

      <View className="flex-row flex-wrap gap-2">
        {DAY_FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </View>

      {view?.featured != null && <FeaturedProgram card={view.featured} onPress={() => open(view.featured!.template.id)} />}

      {view != null && (
        <View className="flex-row flex-wrap justify-between gap-y-3">
          {view.cards.map((card) => (
            <GridProgram
              key={card.template.id}
              card={card}
              nameInset={gridNameInset(width)}
              onPress={() => open(card.template.id)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function FeaturedProgram({ card, onPress }: { card: FeaturedCard; onPress: () => void }) {
  return (
    <DarkSurface>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${card.template.name}. ${card.badge}. ${card.line}`}
        className="active:opacity-90"
      >
        <CoverImage cover={card.cover} variant="card" className="rounded-3xl h-[230px] justify-end">
          <View className="p-4 gap-1.5">
            <View className="self-start px-2.5 py-1 rounded-full bg-accent">
              <Text className="text-accent-fg text-xs font-bold">{card.badge}</Text>
            </View>
            <DisplayName inset={FEATURED_NAME_INSET} sizes={FEATURED_NAME_SIZES}>
              {card.template.name}
            </DisplayName>
            <Text className="text-fg text-[13px]">{card.line}</Text>
          </View>
        </CoverImage>
      </Pressable>
    </DarkSurface>
  );
}

function GridProgram({ card, nameInset, onPress }: { card: ProgramCard; nameInset: number; onPress: () => void }) {
  return (
    <DarkSurface style={{ width: `${GRID_CARD_SHARE * 100}%` }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${card.template.name}. ${card.dayLabel}. ${card.tagline}`}
        className="active:opacity-90"
      >
        <CoverImage cover={card.cover} variant="card" className="rounded-3xl h-[196px] justify-end">
          <View className="p-3 gap-1">
            <SectionLabel color={card.context}>{card.dayLabel}</SectionLabel>
            <DisplayName inset={nameInset} sizes={GRID_NAME_SIZES}>
              {card.template.name}
            </DisplayName>
            <Text className="text-fg text-xs" numberOfLines={1}>
              {card.tagline}
            </Text>
          </View>
        </CoverImage>
      </Pressable>
    </DarkSurface>
  );
}
