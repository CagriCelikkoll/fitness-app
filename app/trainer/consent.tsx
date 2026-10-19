/**
 * Hoca isteği — izin ekranı (v3.6a, öğrenci). Ana sayfadaki istek
 * kartından ya da bildirimden açılır (`id`: bağ kimliği).
 *
 * Rıza metni KVKK v2 "Hocayla paylaşım"; "İzin ver" kutu işaretlenmeden
 * pasif. "Şimdi değil" isteği bekletir (kart ana sayfada kalır); "İsteği
 * reddet" onayla reddeder. Kabulde metnin sürümü (TRAINER_CONSENT_VERSION)
 * ve zamanı sunucuya yazılır.
 *
 * Salon Üye Aydınlatma Metni uygulamada yok: bağlantı web'deki gizlilik
 * sayfasına gidiyor (salon üyeliği bölümü orada).
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { UserRound } from 'lucide-react-native';

import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { getSupabase } from '@/lib/supabase';
import {
  canDo,
  canGiveConsent,
  consentText,
  consentTitle,
  respondTrainerRequest,
  trainerTitle,
} from '@/lib/trainers';
import { ConsentCheckbox } from '@/components/ConsentCard';
import { LegalLink } from '@/components/LegalLink';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';

export default function TrainerConsentScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId, links, loaded, refresh } = useTrainerLinks();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const link = links.find((l) => l.id === id);
  if (!link || !canDo('accept', link, userId)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6 gap-4">
        <Stack.Screen options={{ title: 'Hoca isteği' }} />
        <Text className="text-muted text-base text-center">
          {loaded ? 'Bu istek artık geçerli değil.' : 'Yükleniyor…'}
        </Text>
        {loaded && <SecondaryButton label="Kapat" onPress={close} />}
      </View>
    );
  }

  const respond = async (accept: boolean) => {
    setBusy(accept ? 'accept' : 'decline');
    setError(null);
    const result = await respondTrainerRequest(getSupabase(), link.id, accept);
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message);
      await refresh();
      return;
    }
    await refresh();
    if (accept) {
      Alert.alert('İzin verildi', `${trainerTitle(link.trainerName)} artık devamını görebilir. İzni Ayarlar → Hocalarım'dan geri alabilirsin.`);
    }
    close();
  };

  const confirmDecline = () => {
    Alert.alert('İstek reddedilsin mi?', 'İstek kaldırılır; hiçbir bilgin paylaşılmaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Reddet', style: 'destructive', onPress: () => void respond(false) },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pt-4 pb-12 gap-4">
      <Stack.Screen options={{ title: 'Hoca isteği' }} />
      <Card className="gap-4">
        <View className="flex-row items-center gap-3">
          <View className="w-10 h-10 rounded-full bg-accent/15 items-center justify-center">
            <UserRound color={COLORS.accent} size={20} />
          </View>
          <Text className="text-fg text-lg font-semibold tracking-tight flex-1">{consentTitle(link.trainerName)}</Text>
        </View>
        <Text className="text-fg text-base leading-6">{consentText(link.gymName, link.trainerName)}</Text>
        <LegalLink to="privacy" label="Salon Üye Aydınlatma Metni'ni oku →" />
        <ConsentCheckbox checked={checked} label="Onaylıyorum" onToggle={() => setChecked((c) => !c)} />
        <PrimaryButton
          label="İzin ver"
          disabled={!canGiveConsent(checked, busy != null)}
          loading={busy === 'accept'}
          onPress={() => void respond(true)}
        />
        <SecondaryButton label="Şimdi değil" disabled={busy != null} onPress={close} />
        {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
      </Card>
      <Pressable
        onPress={confirmDecline}
        disabled={busy != null}
        accessibilityRole="button"
        hitSlop={8}
        className="self-center py-2 active:opacity-60"
      >
        <Text className="text-muted text-sm font-semibold">İsteği reddet</Text>
      </Pressable>
    </ScrollView>
  );
}
