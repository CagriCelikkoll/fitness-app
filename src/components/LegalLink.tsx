import { Alert, Linking, Pressable, Text } from 'react-native';

import { LEGAL_URLS } from '@/content/legal';

/**
 * Yayındaki yasal sayfaya bağlantı (v3.4): sistem tarayıcısında açılır
 * (`Linking`, paket yok). Açılamazsa adres gösterilir, elle yazılabilsin.
 */
export function LegalLink({ to, label }: { to: keyof typeof LEGAL_URLS; label: string }) {
  const url = LEGAL_URLS[to];
  const open = () => {
    Linking.openURL(url).catch((err) => {
      console.warn('[LEGAL] Bağlantı açılamadı:', err);
      Alert.alert('Bağlantı açılamadı', url);
    });
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      hitSlop={8}
      className="self-start py-1 active:opacity-60"
    >
      <Text className="text-accent text-sm font-semibold">{label}</Text>
    </Pressable>
  );
}
