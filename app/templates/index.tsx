import { ScrollView, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';

import { COLORS } from '@/theme';
import { Card, SectionHeader } from '@/components/ui';
import {
  templateExerciseCount,
  WORKOUT_TEMPLATES,
} from '@/lib/workoutTemplates';

export default function TemplatesScreen() {
  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 gap-3 pb-12"
    >
      <SectionHeader
        variant="label"
        title="Programı seç, rutinlerine eklensin"
        className="mb-1"
      />
      {WORKOUT_TEMPLATES.map((t) => (
        <Link
          key={t.id}
          href={{ pathname: '/templates/[id]', params: { id: t.id } }}
          asChild
        >
          <Card>
            <View className="flex-row items-start">
              <View className="flex-1 mr-3">
                <Text className="text-white text-xl font-semibold tracking-tight">
                  {t.name}
                </Text>
                <Text className="text-muted text-sm mt-1 leading-5">
                  {t.description}
                </Text>
                <Text className="text-muted text-xs uppercase tracking-widest mt-3 tabular-nums">
                  {t.dayCount} gün · {templateExerciseCount(t)} hareket
                </Text>
              </View>
              <ChevronRight color={COLORS.muted} size={20} />
            </View>
          </Card>
        </Link>
      ))}
    </ScrollView>
  );
}
