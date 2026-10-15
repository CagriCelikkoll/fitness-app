/**
 * Hesabı sil (v3.1c): KVKK silme hakkı ve App Store kuralı.
 *
 * Açıklama → e-postayı yazarak onay → silme (delete_my_account RPC,
 * supabase/migrations/0003_delete_account.sql) → çıkış. Hesap, salon
 * üyeliği ve buluttaki antrenmanlar silinir; telefondaki veriler kalır
 * ve eşitleme durumu sıfırlanır (yeniden giriş yapılırsa ilk eşitleme
 * gibi). Salonun tek yöneticisi silemez, sunucu açıklamayla reddeder.
 */

import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useSession } from '@/hooks/useSession';
import { deleteMyAccount } from '@/lib/account';
import { forgetPushRegistration } from '@/lib/pushNative';
import { getSupabase } from '@/lib/supabase';
import { DELETE_ACCOUNT_TEXT, canConfirmAccountDeletion } from '@/lib/sync/ui';
import { resetSyncAfterAccountDeleted } from '@/lib/syncState';
import { Card, DangerButton } from '@/components/ui';
import { COLORS } from '@/theme';

const INPUT_CLASS = 'bg-bg-elevated text-white text-base px-4 h-12 rounded-xl';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const db = useDb();
  const { available, userId, email } = useSession();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available || !userId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-muted text-base text-center">Giriş yapılmamış.</Text>
      </View>
    );
  }

  const confirmed = canConfirmAccountDeletion(typed, email);

  const submit = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteMyAccount(getSupabase());
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      return;
    }
    // Push token'ı sunucuda hesapla birlikte silindi (cascade); telefondaki kayıt da
    void forgetPushRegistration();
    try {
      await resetSyncAfterAccountDeleted(db);
    } catch (err) {
      console.error('[ACCOUNT] Eşitleme durumu sıfırlanamadı:', err);
    }
    Alert.alert(
      'Hesabın silindi',
      'Hesabın, salon üyeliğin ve buluttaki antrenmanların silindi. Bu telefondaki veriler duruyor.'
    );
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  };

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
          <Text className="text-white text-lg font-semibold tracking-tight">Hesabımı sil</Text>
          <Text className="text-white text-base leading-6">{DELETE_ACCOUNT_TEXT}</Text>
          <Text className="text-muted text-sm leading-5">
            Bu işlem geri alınamaz. Onaylamak için e-posta adresini yaz:{' '}
            <Text className="text-white font-semibold">{email ?? '—'}</Text>
          </Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            editable={!busy}
            placeholder="E-posta adresin"
            placeholderTextColor={COLORS.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            className={INPUT_CLASS}
          />
          <DangerButton
            label={busy ? 'Siliniyor...' : 'Hesabımı kalıcı olarak sil'}
            icon={Trash2}
            disabled={!confirmed || busy}
            loading={busy}
            onPress={() => void submit()}
          />
          {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
