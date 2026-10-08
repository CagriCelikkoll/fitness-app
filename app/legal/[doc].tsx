/**
 * Yasal metin ekranı: /legal/privacy (Gizlilik Politikası),
 * /legal/kvkk (KVKK Aydınlatma Metni). Metinler `src/content/legal.ts`.
 */

import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { LEGAL_DOCUMENTS, type LegalDocId } from '@/content/legal';
import { LegalText } from '@/components/LegalText';

function isLegalDocId(value: string | undefined): value is LegalDocId {
  return value === 'privacy' || value === 'kvkk';
}

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();

  if (!isLegalDocId(doc)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Metin' }} />
        <Text className="text-white text-base">Metin bulunamadı.</Text>
      </View>
    );
  }

  const document = LEGAL_DOCUMENTS[doc];
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pt-4 pb-12">
      <Stack.Screen options={{ title: document.title }} />
      <LegalText blocks={document.blocks} />
    </ScrollView>
  );
}
