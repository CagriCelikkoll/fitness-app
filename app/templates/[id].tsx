/**
 * Hazır program kapağı (v4.0b Bölüm 6): rutin kapağıyla aynı dil; görsel,
 * günler ve altta sabit "Rutinlerime ekle".
 */

import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View, type PressableProps } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { inArray } from 'drizzle-orm';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';

import { CoverImage } from '@/components/CoverImage';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { DisplayName, IconButton, PrimaryButton, SectionLabel } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { exercises } from '@/db/schema';
import { useDb } from '@/hooks/useDb';
import { DarkSurface, useColors } from '@/hooks/useTheme';
import { applyTemplate } from '@/lib/applyTemplate';
import {
  COVER_PAGE_HEIGHT,
  COVER_PAGE_NAME_INSET,
  COVER_PAGE_NAME_SIZES,
  templateCover,
} from '@/lib/coverImage';
import { exerciseDisplayName } from '@/lib/exerciseCatalog';
import { muscleLabels } from '@/lib/exerciseTaxonomy';
import { templateContext, templateCoverLabel, templateCoverStats } from '@/lib/programCatalog';
import { getTemplate, type WorkoutTemplate } from '@/lib/workoutTemplates';

interface ExerciseInfo {
  name: string;
  muscles: string[];
  imagePaths: string | null;
  category: string | null;
  primaryMuscles: string | null;
}

export default function TemplateDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const db = useDb();

  const template = getTemplate(id);
  const [info, setInfo] = useState<Map<string, ExerciseInfo>>(new Map());
  const [applying, setApplying] = useState(false);

  const exerciseIds = useMemo(
    () =>
      template
        ? [...new Set(template.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)))]
        : [],
    [template]
  );

  useEffect(() => {
    if (exerciseIds.length === 0) return;
    db.select({
      id: exercises.id,
      name: exercises.name,
      nameTr: exercises.nameTr,
      primaryMuscles: exercises.primaryMuscles,
      imagePaths: exercises.imagePaths,
      category: exercises.category,
    })
      .from(exercises)
      .where(inArray(exercises.id, exerciseIds))
      .then((rows) => {
        setInfo(
          new Map(
            rows.map((r) => [
              r.id,
              {
                name: exerciseDisplayName(r),
                muscles: muscleLabels(r.primaryMuscles),
                imagePaths: r.imagePaths,
                category: r.category,
                primaryMuscles: r.primaryMuscles,
              },
            ])
          )
        );
      })
      .catch((err) => console.error('[TEMPLATE] Egzersizler okunamadı:', err));
  }, [db, exerciseIds]);

  const handleApply = (t: WorkoutTemplate) => {
    Alert.alert(
      t.name,
      `${t.dayCount} rutin eklenecek. Devam?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Ekle',
          onPress: async () => {
            setApplying(true);
            try {
              await applyTemplate(db, t);
              Alert.alert(
                'Eklendi',
                `${t.dayCount} rutin Rutinler sekmesine eklendi.`,
                [{ text: 'Tamam', onPress: () => router.dismissTo('/workout') }]
              );
            } catch (err) {
              console.error('[TEMPLATE] Uygulama hatası:', err);
              Alert.alert('Hata', String(err));
            } finally {
              setApplying(false);
            }
          },
        },
      ]
    );
  };

  return (
    <DarkSurface className="flex-1">
      <StatusBar style="light" />
      {template ? (
        <TemplateBody template={template} info={info} applying={applying} onApply={() => handleApply(template)} />
      ) : (
        <NotFound />
      )}
    </DarkSurface>
  );
}

function TemplateBody({
  template,
  info,
  applying,
  onApply,
}: {
  template: WorkoutTemplate;
  info: Map<string, ExerciseInfo>;
  applying: boolean;
  onApply: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View className="flex-1 bg-bg">
      <ScrollView className="flex-1" contentContainerClassName="pb-4">
        <CoverImage cover={templateCover(template.id)} variant="page" className="justify-end" style={{ height: COVER_PAGE_HEIGHT }}>
          <View className="px-5 gap-2.5">
            <SectionLabel color={templateContext(template.id)}>{templateCoverLabel(template)}</SectionLabel>
            <DisplayName accessibilityRole="header" inset={COVER_PAGE_NAME_INSET} sizes={COVER_PAGE_NAME_SIZES}>
              {template.name}
            </DisplayName>
            <Text className="text-fg text-sm">{templateCoverStats(template)}</Text>
          </View>
        </CoverImage>

        <View className="px-5 pt-4 gap-5">
          <Text className="text-muted text-sm leading-5">{template.description}</Text>

          {template.days.map((day, dayIdx) => (
            <View key={day.name} className="gap-2">
              <Text accessibilityRole="header" className="text-fg text-[15px] font-bold">
                {dayIdx + 1}. gün — {day.name}
              </Text>
              {day.exercises.map((e, idx) => {
                const ex = info.get(e.exerciseId);
                const line = [`${e.sets} × ${e.reps}`, ...(ex && ex.muscles.length > 0 ? [ex.muscles.join(', ')] : [])].join(' · ');
                // Kütüphanede bulunamayan hareket için detaya gidilmiyor
                if (!ex) return <ExerciseRow key={`${e.exerciseId}-${idx}`} name={e.exerciseId} line={line} disabled />;
                return (
                  <Link key={`${e.exerciseId}-${idx}`} href={{ pathname: '/exercise/[id]', params: { id: e.exerciseId } }} asChild>
                    <ExerciseRow name={ex.name} line={line} exercise={ex} />
                  </Link>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View pointerEvents="box-none" className="absolute left-0 top-0 px-4" style={{ paddingTop: insets.top + 8 }}>
        <IconButton icon={ChevronLeft} variant="ghost" iconSize={22} accessibilityLabel="Geri" onPress={() => router.back()} className="bg-bg/60" />
      </View>

      <View className="px-5 pt-3 pb-4 bg-bg">
        <PrimaryButton label="Rutinlerime ekle" icon={Plus} loading={applying} onPress={onApply} />
      </View>
    </View>
  );
}

/** `Link asChild` dokunuşu `rest` ile veriyor */
function ExerciseRow({
  name,
  line,
  exercise,
  disabled,
  ...rest
}: { name: string; line: string; exercise?: ExerciseInfo } & PressableProps) {
  const COLORS = useColors();
  return (
    <Pressable
      accessibilityRole={disabled ? undefined : 'button'}
      disabled={disabled}
      className="flex-row items-center gap-3 p-2.5 rounded-2xl bg-bg-surface border border-border active:opacity-70"
      {...rest}
    >
      <ExerciseThumb
        imagePaths={exercise?.imagePaths ?? null}
        category={exercise?.category}
        primaryMuscles={exercise?.primaryMuscles}
        size={44}
      />
      <View className="flex-1">
        <Text className="text-fg text-[15px] font-bold" numberOfLines={2}>
          {name}
        </Text>
        <Text className="text-muted text-xs mt-0.5 tabular-nums">{line}</Text>
      </View>
      {!disabled && <ChevronRight color={COLORS.muted} size={18} />}
    </Pressable>
  );
}

function NotFound() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg px-4" style={{ paddingTop: insets.top + 8 }}>
      <IconButton icon={ChevronLeft} accessibilityLabel="Geri" onPress={() => router.back()} />
      <Text className="text-muted text-base text-center mt-10">Program bulunamadı.</Text>
    </View>
  );
}
