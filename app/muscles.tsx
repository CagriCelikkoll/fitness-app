/**
 * Kas haritası (v4.0a Bölüm 4) — İlerleme'deki "Bu hafta kas başına set"
 * kartının "Kas haritası ›" bağlantısı. Eskiden İlerleme sekmesindeki
 * "Bu Hafta Çalışılan Kaslar" kartıydı; içerik aynı: son 7 günde biten
 * antrenmanların tamamlanmış normal setleri, ana kas 1, yardımcı 0,5 set.
 */

import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { MuscleMap } from '@/components/MuscleMap';
import { Card, EmptyState } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { useDb } from '@/hooks/useDb';
import { muscleLabel } from '@/lib/exerciseTaxonomy';
import { formatDecimal } from '@/lib/format';
import { muscleVolume, volumeHighlight } from '@/lib/muscleMap';
import { toMuscleSets, weeklyMuscleSetsQuery, weeklyWindowStart } from '@/lib/weeklyMuscles';

export default function MusclesScreen() {
  const db = useDb();
  const [volume, setVolume] = useState<Record<string, number> | null>(null);

  // Join'li sorgu: her odaklanmada oku (useLiveQuery join'leri dinlemiyor)
  useFocusEffect(
    useCallback(() => {
      let active = true;
      weeklyMuscleSetsQuery(db, weeklyWindowStart(new Date())).then((rows) => {
        if (active) setVolume(muscleVolume(toMuscleSets(rows)));
      });
      return () => {
        active = false;
      };
    }, [db])
  );

  if (!volume) return <View className="flex-1 bg-bg" />;
  const ranked = Object.entries(volume).sort(([, a], [, b]) => b - a);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pt-4 pb-10 gap-3">
      <Text className="text-muted text-sm">Son 7 gün · ana kas 1, yardımcı kas 0,5 set</Text>
      <Card className="gap-4">
        {ranked.length === 0 ? (
          <EmptyState title="Bu hafta henüz antrenman yok" className="py-6" />
        ) : (
          <>
            <MuscleMap highlights={volumeHighlight(volume)} variant="weekly" />
            <View className="gap-2">
              {ranked.map(([muscle, sets]) => (
                <View
                  key={muscle}
                  className="flex-row justify-between"
                  accessible
                  accessibilityLabel={`${muscleLabel(muscle)}: ${formatDecimal(sets)} set`}
                >
                  <Text className="text-fg text-base">{muscleLabel(muscle)}</Text>
                  <Text className="text-muted text-base tabular-nums">{formatDecimal(sets)} set</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>
    </ScrollView>
  );
}
