/**
 * Güncellemeyle gelen kullanıcıya açılışta bir kez sorulan tam ekran
 * rıza sorusu (bkz. `useConsentLaunchCheck`): rıza hiç sorulmamış ve
 * veritabanında vücut ölçüsü kaydı var.
 *
 * - "Onayla" (kutu işaretliyken) → granted
 * - "Onaylamıyorum" → "Vücut ölçüsü kayıtların ne olsun?" seçimi;
 *   "Vazgeç" bu ekranda bırakır
 * Yanıt yazılınca ekran kapanır. Geri tuşu ve kaydırma kapalı: yanıt
 * verilmeden çıkılırsa bir sonraki açılışta yine sorulur.
 */

import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDb } from '@/hooks/useDb';
import { promptConsentWithdraw, useHealthConsent } from '@/hooks/useHealthConsent';
import { ConsentCard } from '@/components/ConsentCard';
import { PrimaryButton, SecondaryButton } from '@/components/ui';

export default function ConsentScreen() {
  const db = useDb();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { grant } = useHealthConsent();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const confirm = async () => {
    setBusy(true);
    const ok = await grant();
    setBusy(false);
    if (ok) close();
  };

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerClassName="px-5 pt-6 pb-6 gap-4">
        <Text className="text-white text-3xl font-bold tracking-tight">
          Vücut ölçüleri
        </Text>
        <Text className="text-muted text-sm leading-5">
          Uygulamada kayıtlı vücut ölçülerin var. Görmeye ve yeni ölçü girmeye
          devam etmek için iznin gerekiyor.
        </Text>
        <ConsentCard checked={checked} onCheckedChange={setChecked} />
        <Pressable
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
          hitSlop={6}
          className="self-start active:opacity-60"
        >
          <Text className="text-accent text-sm font-semibold">Gizlilik Politikası →</Text>
        </Pressable>
      </ScrollView>
      <View
        className="px-5 pt-3 gap-3 border-t border-border bg-bg"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <PrimaryButton
          label="Onayla"
          disabled={!checked}
          loading={busy}
          onPress={() => void confirm()}
        />
        <SecondaryButton
          label="Onaylamıyorum"
          disabled={busy}
          onPress={() => promptConsentWithdraw(db, close)}
        />
      </View>
    </View>
  );
}
