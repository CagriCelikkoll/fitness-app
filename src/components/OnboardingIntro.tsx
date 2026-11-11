import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft } from 'lucide-react-native';

import { CoverImage } from '@/components/CoverImage';
import { IconButton, PrimaryButton } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { DarkSurface, useColors } from '@/hooks/useTheme';
import {
  INTRO_PAGES,
  introCoverHeight,
  introTitleSize,
  type IntroOverlay,
  type IntroPage,
} from '@/lib/onboardingIntro';

/** Yatay boşluk: sayfa kenarları (24 + 24) */
const PAGE_INSET = 48;

interface OnboardingIntroProps {
  page: number;
  onPageChange: (page: number) => void;
  /** Son sayfanın düğmesi */
  onDone: () => void;
  onSkip: () => void;
  skipDisabled: boolean;
  importing: boolean;
  onRestore: () => void;
  /** Hesap kullanılamıyorsa ya da zaten giriş yapılmışsa null */
  onSignIn: (() => void) | null;
}

/**
 * Karşılamanın görselli üç sayfası (v4.0b Bölüm 3). Kaydırılarak ya da
 * düğmeyle geçilir; sayfa durumu ekranda (`page`), düğme ve geri tuşu onu
 * değiştirir, kaydırma buraya bildirir. Fotoğraflar koyu olduğu için açık
 * temada da koyu.
 */
export function OnboardingIntro({
  page,
  onPageChange,
  onDone,
  onSkip,
  skipDisabled,
  importing,
  onRestore,
  onSignIn,
}: OnboardingIntroProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const shown = useRef(page);
  // Sonraki adımdan geri dönünce son sayfadan açılsın
  const initialOffset = useRef({ x: page * width, y: 0 }).current;

  useEffect(() => {
    if (shown.current === page) return;
    shown.current = page;
    scroll.current?.scrollTo({ x: page * width, animated: true });
  }, [page, width]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    if (index === shown.current) return;
    shown.current = index;
    onPageChange(index);
  };

  return (
    <DarkSurface className="flex-1">
      <StatusBar style="light" />
      <View className="flex-1 bg-bg">
        <ScrollView
          ref={scroll}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          contentOffset={initialOffset}
          onMomentumScrollEnd={onScrollEnd}
          className="flex-1"
        >
          {INTRO_PAGES.map((item, index) => (
            <IntroPageView
              key={item.cover}
              item={item}
              index={index}
              width={width}
              top={insets.top}
              onCta={() => (index < INTRO_PAGES.length - 1 ? onPageChange(index + 1) : onDone())}
              importing={importing}
              onRestore={onRestore}
              onSignIn={onSignIn}
            />
          ))}
        </ScrollView>

        <View
          pointerEvents="box-none"
          className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4"
          style={{ paddingTop: insets.top + 8 }}
        >
          {page > 0 ? (
            <IconButton
              icon={ChevronLeft}
              variant="ghost"
              accessibilityLabel="Geri"
              onPress={() => onPageChange(page - 1)}
              className="bg-bg/60"
            />
          ) : (
            <View />
          )}
          <Pressable
            onPress={onSkip}
            disabled={skipDisabled}
            accessibilityRole="button"
            hitSlop={8}
            className="h-11 px-3.5 rounded-[14px] bg-bg/60 justify-center active:opacity-60"
          >
            <Text className="text-fg text-sm font-bold">Atla</Text>
          </Pressable>
        </View>
      </View>
    </DarkSurface>
  );
}

function IntroPageView({
  item,
  index,
  width,
  top,
  onCta,
  importing,
  onRestore,
  onSignIn,
}: {
  item: IntroPage;
  index: number;
  width: number;
  top: number;
  onCta: () => void;
  importing: boolean;
  onRestore: () => void;
  onSignIn: (() => void) | null;
}) {
  const { fontScale } = useWindowDimensions();
  // Yazının ekrandaki yeri bilinene kadar tasarımdaki oran
  const [textTop, setTextTop] = useState<number | null>(null);
  const fontSize = introTitleSize(item.widestLineEm, width - PAGE_INSET, fontScale);

  return (
    <View className="justify-end" style={{ width }}>
      <CoverImage
        cover={item.cover}
        variant="page"
        className="absolute left-0 right-0 top-0"
        style={{ height: textTop == null ? '71%' : introCoverHeight(textTop) }}
      />

      {index === 0 && <BrandBadge top={top} />}
      {item.overlay != null && <Overlay kind={item.overlay} />}

      <View className="px-6 pb-4 gap-4" onLayout={(e) => setTextTop(e.nativeEvent.layout.y)}>
        <Text
          accessibilityRole="header"
          className="font-display text-fg"
          style={{ fontSize, lineHeight: Math.round(fontSize * 1.06) }}
        >
          {item.title.join('\n')}
          {'\n'}
          <Text className="font-display text-accent">{item.accent.join('\n')}</Text>
        </Text>
        <Text className="text-fg text-[15px] leading-[22px]">{item.body}</Text>
        <ProgressDots index={index} count={INTRO_PAGES.length} label={`Sayfa ${index + 1} / ${INTRO_PAGES.length}`} />
        <PrimaryButton label={item.cta} onPress={onCta} />

        {index === 0 && (
          <View className="items-center gap-3">
            {onSignIn != null && (
              <Pressable onPress={onSignIn} accessibilityRole="button" hitSlop={8} className="py-1 active:opacity-60">
                <Text className="text-fg text-sm font-bold">Hesabım var, giriş yap</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onRestore}
              disabled={importing}
              accessibilityRole="button"
              hitSlop={8}
              className="py-1 active:opacity-60"
            >
              <Text className="text-muted text-sm">
                {importing ? (
                  'Geri yükleniyor...'
                ) : (
                  <>
                    Yedeğin var mı? <Text className="text-accent font-semibold">Geri yükle</Text>
                  </>
                )}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function BrandBadge({ top }: { top: number }) {
  return (
    <View
      pointerEvents="none"
      className="absolute left-0 right-0 items-center"
      style={{ top: top + 8 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View className="h-11 flex-row items-center gap-2 px-3.5 rounded-full bg-bg/60 border border-border">
        <View className="w-[22px] h-[22px] rounded-md bg-accent items-center justify-center">
          <Text className="text-accent-fg text-sm font-bold">D</Text>
        </View>
        <Text className="text-fg text-sm font-bold tracking-widest">DİNÇ</Text>
      </View>
    </View>
  );
}

/** Görselin üstündeki örnek kartlar: süsleme, ekran okuyucu görmez */
function Overlay({ kind }: { kind: IntroOverlay }) {
  return (
    <View
      className="px-6 mb-4"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {kind === 'set-saved' ? <SetSavedCard /> : <ProgressChartCard />}
    </View>
  );
}

function SetSavedCard() {
  const COLORS = useColors();
  return (
    <View className="self-center flex-row items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-bg-surface/90 border border-border">
      <View className="w-7 h-7 rounded-[9px] bg-accent items-center justify-center">
        <Check color={COLORS.accentFg} size={16} strokeWidth={2.5} />
      </View>
      <View>
        <Text className="text-muted text-xs">Set 2 kaydedildi</Text>
        <Text className="font-display text-fg text-[15px]">70 kg × 8</Text>
      </View>
    </View>
  );
}

const CHART_BARS = [40, 46, 44, 55, 62, 70, 82, 100];

function ProgressChartCard() {
  return (
    <View className="px-4 py-3.5 rounded-[18px] gap-2.5 bg-bg-surface/90 border border-border">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-fg text-[13px] font-bold">Bench press · tahmini 1RM</Text>
        <Text className="text-accent text-xs font-bold">+12 kg</Text>
      </View>
      <View className="h-11 flex-row items-end gap-[5px]">
        {CHART_BARS.map((height, i) => (
          <View
            key={i}
            className={`flex-1 rounded ${i === CHART_BARS.length - 1 ? 'bg-accent' : 'bg-accent/35'}`}
            style={{ height: `${height}%` }}
          />
        ))}
      </View>
    </View>
  );
}

/** Sayfa / adım göstergesi */
export function ProgressDots({
  index,
  count,
  label,
  className = '',
}: {
  index: number;
  count: number;
  label: string;
  className?: string;
}) {
  return (
    <View className={`flex-row gap-1.5 ${className}`} accessibilityRole="image" accessibilityLabel={label}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} className={`h-1 rounded-sm ${i === index ? 'w-[22px] bg-accent' : 'w-2 bg-border'}`} />
      ))}
    </View>
  );
}
