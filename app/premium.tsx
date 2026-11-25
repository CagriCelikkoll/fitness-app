/**
 * Ödeme duvarı (0.13 Bölüm 7) — yalnızca iskelet. Menülerde girişi yok;
 * bayrak (`PREMIUM_ENABLED`) kapalı. Premium açılırken teklifler
 * (RevenueCat offerings) ve satın alma buraya eklenecek
 * (`docs/premium-notu.md`).
 */

import { ScrollView } from 'react-native';
import { Stack } from 'expo-router';

import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui';
import { usePremium } from '@/hooks/usePremium';

export default function PremiumScreen() {
  const { isPremium } = usePremium();

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pt-4 pb-6 gap-4">
      <Stack.Screen options={{ title: 'Premium' }} />
      <Card className="gap-2">
        <Text className="text-fg text-lg font-semibold tracking-tight">
          {isPremium ? 'Premium açık' : 'Yakında'}
        </Text>
        <Text className="text-muted text-sm leading-5">
          {isPremium ? 'Teşekkürler.' : 'Premium henüz kullanılamıyor.'}
        </Text>
      </Card>
    </ScrollView>
  );
}
