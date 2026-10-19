/**
 * QR afişi (v3.6c, yalnızca yönetici). Salon paneli → "QR afişi". Tam
 * ekran beyaz afiş: salon adı, QR, "Dinç uygulamasıyla okut". Ekran
 * görüntüsü alınıp yazdırılır. "QR'ı yenile" (onaylı) eski afişi geçersiz
 * kılar.
 *
 * Afiş temadan bağımsız beyaz (QR okuyucular açık zemin bekliyor).
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import type { AccountError } from '@/lib/auth';
import { canManageGym } from '@/lib/gymAdmin';
import { getSupabase } from '@/lib/supabase';
import { buildCheckinQr, fetchCheckinKey, rotateCheckinKey } from '@/lib/visits';
import { QrCode } from '@/components/QrCode';
import { SecondaryButton } from '@/components/ui';
import { QR_COLORS } from '@/theme';

export default function GymQrScreen() {
  const { width } = useWindowDimensions();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships } = useGymMembership();
  const gym = memberships.find((m) => m.gymId === gymId);
  const allowed = gymId != null && canManageGym(gymId, memberships);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<AccountError | null>(null);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    if (!allowed || !gymId) return;
    const result = await fetchCheckinKey(getSupabase(), gymId);
    if (result.ok) {
      setSecret(result.value.secret);
      setError(null);
    } else setError(result.error);
  }, [allowed, gymId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rotate = () =>
    Alert.alert('QR yenilensin mi?', 'Eski afiş çalışmayacak, yenisini asmalısın.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Yenile',
        style: 'destructive',
        onPress: async () => {
          if (!gymId) return;
          setRotating(true);
          const result = await rotateCheckinKey(getSupabase(), gymId);
          setRotating(false);
          if (result.ok) setSecret(result.value.secret);
          else Alert.alert('Yenilenemedi', result.error.message);
        },
      },
    ]);

  if (!allowed || !gymId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'QR afişi' }} />
        <Text className="text-muted text-base text-center">QR afişi yalnızca yöneticilere açık.</Text>
      </View>
    );
  }

  const qrSize = Math.min(width - 80, 360);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pt-4 pb-12 gap-4">
      <Stack.Screen options={{ title: 'QR afişi' }} />
      <View className="rounded-3xl items-center px-6 py-8 gap-5" style={{ backgroundColor: QR_COLORS.light }}>
        <Text className="text-3xl font-bold text-center" style={{ color: QR_COLORS.dark }}>
          {gym?.gymName ?? 'Salon'}
        </Text>
        <Text className="text-base text-center" style={{ color: QR_COLORS.dark }}>
          Salona giriş
        </Text>
        {secret ? (
          <QrCode value={buildCheckinQr(gymId, secret)} size={qrSize} />
        ) : (
          <View style={{ width: qrSize, height: qrSize }} className="items-center justify-center">
            {error ? (
              <Text className="text-center" style={{ color: QR_COLORS.dark }}>
                {error.message}
              </Text>
            ) : (
              <ActivityIndicator color={QR_COLORS.dark} />
            )}
          </View>
        )}
        <Text className="text-lg font-semibold text-center" style={{ color: QR_COLORS.dark }}>
          Dinç uygulamasıyla okut
        </Text>
      </View>
      <Text className="text-muted text-sm leading-5 px-1">
        Ekran görüntüsü alıp yazdır ve girişe as. Üyeler Salon sekmesindeki "Salona giriş" ile ya da telefonun kamerasıyla
        okutabilir.
      </Text>
      <SecondaryButton label={rotating ? 'Yenileniyor...' : "QR'ı yenile"} icon={RefreshCw} loading={rotating} onPress={rotate} />
      {error != null && secret == null && <SecondaryButton label="Tekrar dene" onPress={() => void load()} />}
    </ScrollView>
  );
}
