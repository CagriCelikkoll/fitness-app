import { Text, View } from 'react-native';

export default function ProgressScreen() {
  return (
    <View className="flex-1 bg-bg items-center justify-center p-6">
      <Text className="text-white text-xl font-semibold">İlerleme</Text>
      <Text className="text-muted text-sm text-center mt-2">
        Vücut ağırlığı, 1RM tahminleri, hacim grafikleri ve kas grubu ısı
        haritası burada gözükecek.
      </Text>
    </View>
  );
}
