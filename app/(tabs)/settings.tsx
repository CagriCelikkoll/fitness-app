import { Text, View } from 'react-native';

export default function SettingsScreen() {
  return (
    <View className="flex-1 bg-bg items-center justify-center p-6">
      <Text className="text-white text-xl font-semibold">Ayarlar</Text>
      <Text className="text-muted text-sm text-center mt-2">
        Birim tercihleri, varsayılan dinlenme süresi, dil, tema ve veri ihracı
        burada olacak.
      </Text>
    </View>
  );
}
