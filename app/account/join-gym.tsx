/**
 * Salona katılma (v3.0): kod → "Salonu bul" (preview_gym, yalnızca ad)
 * → "Katıl" (join_gym) → Ayarlar'a dönüş, salon kartı orada.
 *
 * Kod normalleştirme `normalizeJoinCode` (" eu-7k2 " → "EU7K2").
 * Kaba kuvvet sınırı sunucuda (saatte 10 hatalı deneme).
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { JOIN_CODE_MAX, isValidJoinCode, normalizeJoinCode, roleLabel } from '@/lib/auth';
import { joinGym, previewGym } from '@/lib/account';
import { getSupabase } from '@/lib/supabase';
import { useGymMembership } from '@/hooks/useGymMembership';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';
import { COLORS } from '@/theme';

export default function JoinGymScreen() {
  const router = useRouter();
  const { available, userId, refresh } = useGymMembership();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{ code: string; gymName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeJoinCode(code);

  const findGym = async () => {
    setBusy(true);
    setError(null);
    const result = await previewGym(getSupabase(), normalized);
    setBusy(false);
    if (result.ok) setPreview({ code: normalized, gymName: result.value });
    else setError(result.error.message);
  };

  const join = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const result = await joinGym(getSupabase(), preview.code);
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      return;
    }
    await refresh();
    setBusy(false);
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  };

  if (!available || !userId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-muted text-base text-center">
          Salona katılmak için önce giriş yap.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-bg"
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4 gap-4 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <Card className="gap-4">
          <Text className="text-muted text-sm leading-5">
            Salon kodunu salonundan alabilirsin.
          </Text>
          <View>
            <Text className="text-muted text-xs mb-2">Salon kodu</Text>
            <TextInput
              value={code}
              onChangeText={(text) => {
                setCode(text);
                setError(null);
                if (preview && normalizeJoinCode(text) !== preview.code) setPreview(null);
              }}
              editable={!busy}
              placeholder="ABC123"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={JOIN_CODE_MAX + 4}
              returnKeyType="search"
              onSubmitEditing={() => !preview && isValidJoinCode(code) && void findGym()}
              className="bg-bg-elevated text-white text-xl tracking-[4px] px-4 h-12 rounded-xl text-center"
            />
          </View>

          {preview == null ? (
            <PrimaryButton
              label="Salonu bul"
              disabled={busy || !isValidJoinCode(code)}
              loading={busy}
              onPress={() => void findGym()}
            />
          ) : (
            <>
              <View className="bg-bg-elevated rounded-2xl p-4 gap-1">
                <Text className="text-muted text-xs">Salon</Text>
                <Text className="text-white text-lg font-semibold">{preview.gymName}</Text>
                <Text className="text-muted text-xs">
                  {roleLabel('member')} olarak katılacaksın.
                </Text>
              </View>
              <PrimaryButton
                label="Katıl"
                disabled={busy}
                loading={busy}
                onPress={() => void join()}
              />
              <SecondaryButton
                label="Vazgeç"
                disabled={busy}
                onPress={() => {
                  setPreview(null);
                  setCode('');
                }}
              />
            </>
          )}

          {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
