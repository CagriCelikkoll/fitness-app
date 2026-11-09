/**
 * Egzersiz detayının parçaları. Tam ekran detay (`app/exercise/[id].tsx`)
 * bunları sekmelere dağıtıyor; seçicideki önizleme ve odak panelindeki "Nasıl
 * yapılır" tek parça `ExerciseDetailContent`'i kullanıyor.
 *
 * Kaydırma kabı, başlık ve yükleme durumu çağıran tarafta.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';

import { exerciseDisplayName, exerciseOriginalName } from '@/lib/exerciseCatalog';
import { useColors } from '@/hooks/useTheme';
import type { Exercise } from '@/db/schema';
import { EXERCISE_IMAGE_CACHE, getExerciseImageUrls } from '@/lib/exerciseImage';
import {
  parseInstructions,
  resolveInstructions,
} from '@/lib/exerciseTranslations';
import {
  equipmentLabel,
  forceLabel,
  levelLabel,
  mechanicLabel,
  muscleLabels,
  parseMuscles,
} from '@/lib/exerciseTaxonomy';
import { exerciseHighlight } from '@/lib/muscleMap';
import { youtubeSearchUrl } from '@/lib/youtube';
import {
  Card,
  Chip,
  SecondaryButton,
  SectionHeader,
} from '@/components/ui';
import { MuscleMap } from '@/components/MuscleMap';

export function ExerciseDetailContent({ exercise }: { exercise: Exercise }) {
  const imageUrls = getExerciseImageUrls(exercise.imagePaths);
  const displayName = exerciseDisplayName(exercise);
  const originalName = exerciseOriginalName(exercise);

  return (
    <>
      <View className="mb-2">
        <Text className="text-fg text-4xl font-bold tracking-tight">
          {displayName}
        </Text>
        {originalName != null && (
          <Text className="text-muted text-sm mt-2">{originalName}</Text>
        )}
      </View>

      {/* Görseller. key: seçicide başka harekete geçince animasyon durumu
          (yükleme, duraklatma, kare) sıfırdan başlasın */}
      {imageUrls.length > 0 && (
        <ExerciseImages key={exercise.id} urls={imageUrls.slice(0, 2)} />
      )}

      <ExerciseQuickInfo exercise={exercise} />
      <ExerciseMuscles exercise={exercise} />
      <ExerciseHowTo exercise={exercise} />
    </>
  );
}

/** Ekipman, mekanik, kuvvet, seviye */
export function ExerciseQuickInfo({ exercise }: { exercise: Exercise }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {exercise.equipment && (
        <Chip
          size="sm"
          label={`Ekipman: ${equipmentLabel(exercise.equipment)}`}
        />
      )}
      {exercise.mechanic && (
        <Chip size="sm" label={mechanicLabel(exercise.mechanic)} />
      )}
      {exercise.force && (
        <Chip size="sm" label={forceLabel(exercise.force)} />
      )}
      {exercise.level && (
        <Chip size="sm" label={`Seviye: ${levelLabel(exercise.level)}`} />
      )}
    </View>
  );
}

/** Kas haritası, birincil ve ikincil kaslar */
export function ExerciseMuscles({ exercise }: { exercise: Exercise }) {
  const primaryMuscles = muscleLabels(exercise.primaryMuscles);
  const secondaryMuscles = muscleLabels(exercise.secondaryMuscles);
  const highlights = exerciseHighlight(
    parseMuscles(exercise.primaryMuscles),
    parseMuscles(exercise.secondaryMuscles)
  );
  return (
    <>
      <SectionHeader title="Çalıştırılan Kaslar" className="mt-4" />
      <Card className="gap-4">
        {highlights.length > 0 && <MuscleMap highlights={highlights} />}
        {primaryMuscles.length > 0 && (
          <View>
            <Text className="text-muted text-[13px]">
              Birincil
            </Text>
            <Text className="text-fg text-base mt-1">
              {primaryMuscles.join(', ')}
            </Text>
          </View>
        )}
        {secondaryMuscles.length > 0 && (
          <View>
            <Text className="text-muted text-[13px]">
              İkincil
            </Text>
            <Text className="text-fg text-base mt-1">
              {secondaryMuscles.join(', ')}
            </Text>
          </View>
        )}
      </Card>
    </>
  );
}

/** Video araması + talimatlar */
export function ExerciseHowTo({ exercise, showTitle = true }: { exercise: Exercise; showTitle?: boolean }) {
  const resolved = resolveInstructions(exercise.id, exercise.instructions);
  // Hareket id'sine bağlı: seçicide başka harekete geçince Türkçeye döner
  const [originalFor, setOriginalFor] = useState<string | null>(null);
  const showOriginal = resolved.isTranslated && originalFor === exercise.id;
  const instructions = showOriginal
    ? parseInstructions(exercise.instructions)
    : resolved.steps;

  const openVideo = () => {
    Linking.openURL(youtubeSearchUrl(exercise.name)).catch((err) => {
      console.warn('[YOUTUBE] Bağlantı açılamadı:', err);
    });
  };

  return (
    <>
      {showTitle && <SectionHeader title="Nasıl Yapılır" className="mt-4" />}
      <SecondaryButton label="Videolu anlatım" icon={Play} iconFill onPress={openVideo} />
      {instructions.length > 0 && (
        <Card className="gap-4">
          {instructions.map((step, idx) => (
            <View key={idx} className="flex-row">
              <Text className="text-muted font-semibold tabular-nums w-7">
                {idx + 1}.
              </Text>
              <Text className="text-fg text-base leading-6 flex-1">
                {step}
              </Text>
            </View>
          ))}
        </Card>
      )}
      {resolved.isTranslated && (
        <Pressable
          onPress={() => setOriginalFor(showOriginal ? null : exercise.id)}
          hitSlop={8}
          className="self-start active:opacity-60"
        >
          <Text className="text-muted text-sm underline">
            {showOriginal ? 'Çeviriyi göster' : 'Orijinalini göster'}
          </Text>
        </Pressable>
      )}
    </>
  );
}

// ============================================================================
// Görseller — başlangıç/bitiş pozisyonu arasında crossfade animasyonu
// ============================================================================

/** Kareler arası süre; geçiş bu sürenin içinde */
const FRAME_INTERVAL_MS = 800;
const CROSSFADE_MS = 250;

/**
 * İki görselli harekette tek kutuda başlangıç ↔ bitiş animasyonu.
 *
 * - Animasyon iki görsel de `Image.prefetch` ile indirildikten sonra
 *   başlıyor; o zamana kadar ilk görsel sabit duruyor (yarım yüklenmiş
 *   karede titreme olmasın). expo-image önbelleğindeki görsel internetsiz
 *   de hazır sayılıyor.
 * - Üst kare expo-image'ı saran bir Animated.View; opaklık onun üstünde
 *   (expo-image'ın Animated sürümü yok, RN Animated.Image'dan taşındı).
 * - Ön yükleme başarısızsa (internet yok) ya da cihazda "hareketi azalt"
 *   açıksa eski yan yana görünüm.
 * - Tek görselde de eski görünüm (tek kutu).
 * - Kutuya basınca duraklıyor / devam ediyor.
 *
 * Görseller kartı doldurur (`cover`): fotoğraflar kartla aynı oranda değil,
 * `contain` üstte ve altta zemin şeridi bırakıyor.
 *
 * Yalnızca detay içeriğinde kullanılıyor; liste küçük resimleri sabit.
 */
export function ExerciseImages({ urls }: { urls: string[] }) {
  const COLORS = useColors();
  const canAnimate = urls.length >= 2;

  // null: henüz okunmadı. Okunana kadar eski görünüm.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [prefetch, setPrefetch] = useState<'loading' | 'ready' | 'failed'>(
    'loading'
  );
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState<0 | 1>(0);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!canAnimate) return;
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (active) setReduceMotion(v);
      })
      .catch(() => {
        if (active) setReduceMotion(true);
      });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => {
      active = false;
      sub.remove();
    };
  }, [canAnimate]);

  const animated = canAnimate && reduceMotion === false;

  useEffect(() => {
    if (!animated) return;
    let active = true;
    Promise.all(urls.map((u) => Image.prefetch(u, EXERCISE_IMAGE_CACHE)))
      .then((results) => {
        if (active) setPrefetch(results.every(Boolean) ? 'ready' : 'failed');
      })
      .catch(() => {
        if (active) setPrefetch('failed');
      });
    return () => {
      active = false;
    };
    // urls her render'da yeni dizi; içerik değişince bileşen zaten key
    // ile yeniden kuruluyor
  }, [animated]);

  const running = animated && prefetch === 'ready' && !paused;

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(
      () => setFrame((f) => (f === 0 ? 1 : 0)),
      FRAME_INTERVAL_MS
    );
    return () => clearInterval(interval);
  }, [running]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: frame,
      duration: CROSSFADE_MS,
      useNativeDriver: true,
    }).start();
  }, [frame, opacity]);

  if (!animated || prefetch === 'failed') {
    return (
      <View className="flex-row gap-3">
        {urls.map((url, idx) => (
          <View
            key={idx}
            className="flex-1 bg-bg-surface border border-border rounded-3xl overflow-hidden aspect-square"
          >
            <Image
              source={{ uri: url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              cachePolicy={EXERCISE_IMAGE_CACHE}
            />
          </View>
        ))}
      </View>
    );
  }

  const ready = prefetch === 'ready';

  return (
    <Pressable
      onPress={() => setPaused((p) => !p)}
      disabled={!ready}
      accessibilityRole="button"
      accessibilityLabel={
        paused ? 'Hareket animasyonunu oynat' : 'Hareket animasyonunu durdur'
      }
      className="bg-bg-surface border border-border rounded-3xl overflow-hidden active:opacity-80"
      style={{ aspectRatio: 4 / 3 }}
    >
      <Image
        source={{ uri: urls[0] }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy={EXERCISE_IMAGE_CACHE}
      />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        <Image
          source={{ uri: urls[1] }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy={EXERCISE_IMAGE_CACHE}
        />
      </Animated.View>
      {paused && (
        <View className="absolute right-3 bottom-3 w-9 h-9 rounded-full bg-bg/80 items-center justify-center">
          <Play color={COLORS.text} size={16} fill={COLORS.text} />
        </View>
      )}
    </Pressable>
  );
}
