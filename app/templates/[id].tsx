import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { inArray } from 'drizzle-orm';
import { Plus } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { exercises } from '@/db/schema';
import { Card, ListRow, PrimaryButton, SectionHeader } from '@/components/ui';
import { applyTemplate } from '@/lib/applyTemplate';
import { muscleLabels } from '@/lib/exerciseTaxonomy';
import { getTemplate } from '@/lib/workoutTemplates';

interface ExerciseInfo {
  name: string;
  muscles: string[];
}

export default function TemplateDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const db = useDb();
  const insets = useSafeAreaInsets();

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
    })
      .from(exercises)
      .where(inArray(exercises.id, exerciseIds))
      .then((rows) => {
        setInfo(
          new Map(
            rows.map((r) => [
              r.id,
              {
                name: r.nameTr ?? r.name,
                muscles: muscleLabels(r.primaryMuscles),
              },
            ])
          )
        );
      })
      .catch((err) => console.error('[TEMPLATE] Egzersizler okunamadı:', err));
  }, [db, exerciseIds]);

  if (!template) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-muted text-center">Program bulunamadı.</Text>
      </View>
    );
  }

  const handleApply = () => {
    Alert.alert(
      template.name,
      `${template.dayCount} rutin eklenecek. Devam?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Ekle',
          onPress: async () => {
            setApplying(true);
            try {
              await applyTemplate(db, template);
              Alert.alert(
                'Eklendi',
                `${template.dayCount} rutin Antrenman sekmesine eklendi.`,
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
    <>
      <Stack.Screen options={{ title: template.name }} />
      <View className="flex-1 bg-bg">
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pt-4 gap-3 pb-6"
        >
          <Text className="text-muted text-sm leading-5 mb-2">
            {template.description}
          </Text>

          {template.days.map((day, dayIdx) => (
            <View key={day.name} className="gap-2 mt-2">
              <SectionHeader
                variant="label"
                title={`${dayIdx + 1}. gün — ${day.name}`}
              />
              <Card className="py-1">
                {day.exercises.map((e, idx) => {
                  const ex = info.get(e.exerciseId);
                  const row = (
                    <ListRow
                      key={`${e.exerciseId}-${idx}`}
                      divider={idx > 0}
                      chevron={ex != null}
                      right={
                        <Text className="text-white text-sm font-semibold tabular-nums">
                          {e.sets} × {e.reps}
                        </Text>
                      }
                    >
                      <Text className="text-white text-base" numberOfLines={2}>
                        {ex?.name ?? e.exerciseId}
                      </Text>
                      {ex && ex.muscles.length > 0 && (
                        <Text className="text-muted text-xs mt-0.5">
                          {ex.muscles.join(', ')}
                        </Text>
                      )}
                    </ListRow>
                  );
                  // Kütüphanede bulunamayan hareket için detaya gidilmiyor
                  if (!ex) return row;
                  return (
                    <Link
                      key={`${e.exerciseId}-${idx}`}
                      href={{
                        pathname: '/exercise/[id]',
                        params: { id: e.exerciseId },
                      }}
                      asChild
                    >
                      {row}
                    </Link>
                  );
                })}
              </Card>
            </View>
          ))}
        </ScrollView>

        <View
          className="px-5 pt-3 border-t border-border bg-bg"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <PrimaryButton
            label="Rutinlerime Ekle"
            icon={Plus}
            loading={applying}
            onPress={handleApply}
          />
        </View>
      </View>
    </>
  );
}
