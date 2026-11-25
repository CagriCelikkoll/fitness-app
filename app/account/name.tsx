/**
 * Adın (profiles.display_name). Ayarlar'daki "Hesap ve salon"dan ve ana
 * sayfadaki "Adını ekle" kartından açılır. Ad isteğe bağlı; yalnızca
 * salonunun hocaları ve yöneticisi görür (duyuru yazdıysan o duyuruyu
 * görenler de). Uzunluk sınırı sunucuda da var (0007_display_name.sql).
 *
 * 0.13: Google ile girişten sonra `suggest` (Google'daki ad) gelirse alan
 * onunla dolar; kurala uymuyorsa hata hemen görünür, kullanıcı düzeltir.
 * Kaydetmeden sunucuya bir şey yazılmaz; "Şimdi değil" ile geçilir. Ad bu
 * hesapta bir kez önerilir (ana sayfadaki "Adını ekle" kartıyla ortak
 * işaret). `next=join-gym`: sonra salon kodu ekranı.
 */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import { useProfile } from '@/hooks/useProfile';
import { useSession } from '@/hooks/useSession';
import { useColors } from '@/hooks/useTheme';
import {
  DISPLAY_NAME_MAX,
  displayNameError,
  displayNameLength,
  markNamePrompted,
  normalizeDisplayName,
} from '@/lib/profile';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';

export default function NameScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { available, userId } = useSession();
  const { displayName, loaded, save } = useProfile();
  const params = useLocalSearchParams<{ suggest?: string; next?: string }>();
  const suggestion = typeof params.suggest === 'string' && params.suggest ? params.suggest : null;
  const [text, setText] = useState(displayName ?? suggestion ?? '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ad sunucudan geç gelirse (kullanıcı henüz yazmadıysa) alanı doldur
  useEffect(() => {
    if (!touched) setText(displayName ?? suggestion ?? '');
  }, [displayName, suggestion, touched]);

  // Öneriyle açıldıysa ad bu hesapta soruldu sayılır
  useEffect(() => {
    if (suggestion == null || !userId) return;
    markNamePrompted(Storage, userId).catch(() => undefined);
  }, [suggestion, userId]);

  if (!available || !userId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Adın' }} />
        <Text className="text-muted text-base text-center">Önce giriş yap.</Text>
      </View>
    );
  }

  const suggested = suggestion != null && displayName == null;
  const validation = displayNameError(text);
  const unchanged = normalizeDisplayName(text) === (displayName ?? '');
  const count = displayNameLength(text);
  // Öneri kurala uymuyorsa hata, kullanıcı yazmadan da görünsün
  const showError = touched || suggested;

  const finish = () => {
    if (params.next === 'join-gym') return router.replace('/account/join-gym');
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  };

  const submit = async () => {
    if (validation || busy) return;
    setBusy(true);
    setError(null);
    const failure = await save(text);
    setBusy(false);
    if (failure) {
      setError(failure.message);
      return;
    }
    finish();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Adın' }} />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 gap-4 pb-12" keyboardShouldPersistTaps="handled">
        <Card className="gap-4">
          {suggested && (
            <Text className="text-fg text-sm leading-5">
              Google hesabındaki adını önerdik. İstersen değiştir ya da şimdilik geç.
            </Text>
          )}
          <Text className="text-muted text-sm leading-5">
            Hocaların seni tanısın diye adını yaz. Yalnızca salonunun hocaları ve yöneticisi görür; diğer üyeler
            görmez.
          </Text>
          <View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-muted text-xs">Adın</Text>
              <Text className={`text-xs tabular-nums ${count > DISPLAY_NAME_MAX ? 'text-danger' : 'text-muted'}`}>
                {count}/{DISPLAY_NAME_MAX}
              </Text>
            </View>
            <TextInput
              value={text}
              onChangeText={(t) => {
                setTouched(true);
                setText(t);
                setError(null);
              }}
              editable={!busy && loaded}
              placeholder="Ör. Ayşe Yılmaz"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              className="bg-bg-elevated text-fg text-base px-4 h-12 rounded-xl"
            />
            {validation != null && showError && <Text className="text-danger text-xs mt-1.5">{validation}</Text>}
          </View>
          <PrimaryButton
            label="Kaydet"
            disabled={!loaded || busy || validation != null || unchanged}
            loading={busy}
            onPress={() => void submit()}
          />
          {suggested && <SecondaryButton label="Şimdi değil" disabled={busy} onPress={finish} />}
          {displayName != null && (
            <Text className="text-muted text-xs leading-5">Adı silmek için alanı boşaltıp kaydet.</Text>
          )}
          {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
