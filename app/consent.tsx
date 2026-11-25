/**
 * Açılışta sorulan tam ekran rıza sorusu (bkz. `runConsentLaunchCheck`):
 * - rıza hiç sorulmamış ve veritabanında vücut ölçüsü kaydı var (v2.2), ya da
 * - `renew=1`: eski rıza metnine onay verilmiş (0.13: telefonun kendi yedeği
 *   metne girdi); kayıt olmasa da sorulur.
 *
 * Hesabın aydınlatma onayı da bekliyorsa (`usePrivacyNotice().needsAck`)
 * aynı ekranda, üstte: iki kutu, tek "Onayla". Ana sayfadaki aydınlatma
 * kartı onay yazılınca kaybolur.
 *
 * - "Onayla" (kutular işaretliyken) → granted (+ aydınlatma onayı)
 * - "Onaylamıyorum" → "Vücut ölçüsü kayıtların ne olsun?" seçimi (rızayı
 *   geri alma akışının aynısı); "Vazgeç" bu ekranda bırakır. Aydınlatma
 *   kutusu işaretliyse onay yine yazılır.
 * Yanıt yazılınca ekran kapanır. Geri tuşu ve kaydırma kapalı: yanıt
 * verilmeden çıkılırsa bir sonraki açılışta yine sorulur.
 */

import { useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDb } from '@/hooks/useDb';
import { promptConsentWithdraw, useHealthConsent } from '@/hooks/useHealthConsent';
import { usePrivacyNotice } from '@/hooks/usePrivacyNotice';
import { canConfirmConsentScreen } from '@/lib/consent';
import { PRIVACY_NOTICE_CHECKBOX, privacyAckCardText } from '@/lib/privacyNotice';
import { ConsentCard, ConsentCheckbox } from '@/components/ConsentCard';
import { LegalLink } from '@/components/LegalLink';
import { TextLink } from '@/components/TextLink';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';

export default function ConsentScreen() {
  const db = useDb();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { renew } = useLocalSearchParams<{ renew?: string }>();
  const renewing = renew === '1';
  const { grant } = useHealthConsent();
  const notice = usePrivacyNotice();
  const [checked, setChecked] = useState(false);
  const [noticeChecked, setNoticeChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  // Aydınlatma bölümü bir kez göründüyse, onay yazılınca da yerinde kalsın
  // (ekran zıplamasın); karar o anki duruma göre
  const [noticeShown, setNoticeShown] = useState(false);
  useEffect(() => {
    if (notice.needsAck) setNoticeShown(true);
  }, [notice.needsAck]);
  const noticeNeeded = notice.needsAck;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  /** İşaretliyse aydınlatma onayını yaz; yazılamazsa ana sayfadaki kart kalır */
  const saveNotice = async () => {
    if (!noticeNeeded || !noticeChecked) return;
    const err = await notice.acknowledge();
    if (err) {
      Alert.alert('Aydınlatma onayı kaydedilemedi', `${err.message} Ana sayfadan tekrar deneyebilirsin.`);
    }
  };

  const confirm = async () => {
    setBusy(true);
    const ok = await grant();
    if (ok) await saveNotice();
    setBusy(false);
    if (ok) close();
  };

  const decline = () =>
    promptConsentWithdraw(db, () => {
      void saveNotice().finally(close);
    });

  const canConfirm = canConfirmConsentScreen({ consentChecked: checked, noticeNeeded, noticeChecked });
  const ackCopy = privacyAckCardText(notice.storedVersion);

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerClassName="px-5 pt-6 pb-6 gap-4">
        <Text className="text-fg text-3xl font-bold tracking-tight">
          {noticeShown ? 'Güncellenen metinler' : 'Vücut ölçüleri'}
        </Text>

        {noticeShown && (
          <Card className="gap-3">
            <Text className="text-fg text-lg font-semibold tracking-tight">{ackCopy.title}</Text>
            <Text className="text-muted text-sm leading-5">{ackCopy.body}</Text>
            <View>
              <TextLink
                label="Aydınlatma Metni →"
                onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'kvkk' } })}
              />
              <LegalLink to="privacy" label="Gizlilik Politikası →" />
            </View>
            {noticeNeeded ? (
              <ConsentCheckbox
                checked={noticeChecked}
                label={PRIVACY_NOTICE_CHECKBOX}
                onToggle={() => setNoticeChecked((c) => !c)}
              />
            ) : (
              <Text className="text-success text-sm font-semibold">Kaydedildi</Text>
            )}
          </Card>
        )}

        <Text className="text-muted text-sm leading-5">
          {renewing
            ? 'Vücut ölçülerine verdiğin iznin metni güncellendi: telefonunun kendi yedeklemesi açıksa ölçülerin Google hesabındaki cihaz yedeğine de girebilir. Ölçülerini görmeye ve yeni ölçü girmeye devam etmek için iznini yenile.'
            : 'Uygulamada kayıtlı vücut ölçülerin var. Görmeye ve yeni ölçü girmeye devam etmek için iznin gerekiyor.'}
        </Text>
        <ConsentCard checked={checked} onCheckedChange={setChecked} showNoticeLink={!noticeShown} />
        {!noticeShown && (
          <Pressable
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
            hitSlop={6}
            className="self-start active:opacity-60"
          >
            <Text className="text-accent text-sm font-semibold">Gizlilik Politikası →</Text>
          </Pressable>
        )}
      </ScrollView>
      <View className="px-5 pt-3 pb-4 gap-3 border-t border-border bg-bg">
        <PrimaryButton label="Onayla" disabled={!canConfirm} loading={busy} onPress={() => void confirm()} />
        <SecondaryButton label="Onaylamıyorum" disabled={busy} onPress={decline} />
      </View>
    </View>
  );
}
