import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Sparkles } from 'lucide-react-native';

import { PrimaryButton, SecondaryButton, SectionLabel } from '@/components/ui';
import { CornerGlow } from '@/components/ui/CornerGlow';
import { Text } from '@/components/ui/Text';
import { upperTr } from '@/lib/typography';

/** "Programını seç" kartı: ana sayfada ve boş Rutinler sekmesinde aynı */
export function ChooseProgramCard({ label }: { label: string }) {
  const router = useRouter();
  return (
    <View className="rounded-3xl overflow-hidden bg-bg-surface border border-border">
      <CornerGlow />
      <View className="p-[18px] gap-3">
        <SectionLabel>{label}</SectionLabel>
        <Text accessibilityRole="header" className="font-display text-fg text-[30px] leading-[32px]">
          {upperTr('Programını seç')}
        </Text>
        <Text className="text-muted text-sm">Hazır programlardan birini seç ya da sana uygun olanı önerelim.</Text>
        <PrimaryButton label="Bana program öner" icon={Sparkles} onPress={() => router.push('/templates/recommend')} />
        <SecondaryButton label="Hazır programlar" onPress={() => router.push('/templates')} />
      </View>
    </View>
  );
}
