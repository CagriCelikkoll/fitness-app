import { Text, View } from 'react-native';

import type { HeatmapDay } from '@/lib/visits';

const DAY_LABELS = ['Pzt', '', 'Çar', '', 'Cum', '', 'Paz'];

/**
 * Son 8 haftanın gün kareleri (v3.6c): sütun = hafta (eski solda), satır
 * = gün (pazartesi üstte). Gelinen gün salon renginde.
 */
export function VisitHeatmap({ weeks }: { weeks: HeatmapDay[][] }) {
  return (
    <View className="flex-row gap-1" accessibilityLabel="Son 8 haftada salona gelinen günler">
      <View className="gap-1 mr-1">
        {DAY_LABELS.map((l, i) => (
          <Text key={i} className="text-muted text-[9px] h-4 leading-4">
            {l}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0].date} className="flex-1 gap-1">
          {week.map((d) => (
            <View
              key={d.date}
              className={`h-4 rounded ${d.future ? '' : d.count > 0 ? 'bg-accent' : 'bg-bg-elevated'}`}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
