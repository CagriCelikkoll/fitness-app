/**
 * Giriş (v3.0): e-posta → "Kod gönder" → e-postadaki 6 haneli kod →
 * "Giriş yap". Şifre ve magic link yok. Hesap yoksa ilk girişte açılır.
 *
 * Durum mantığı saf: `otpReducer` (src/lib/auth.ts). "Kodu tekrar
 * gönder" 60 sn sonra açılır.
 *
 * Bayrak kapalıysa / env yoksa ekran açıklama gösterip istek atmaz.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import {
  INITIAL_OTP_STATE,
  OTP_LENGTH,
  canResend,
  canSendCode,
  canVerify,
  normalizeEmail,
  otpReducer,
  resendSecondsLeft,
} from '@/lib/auth';
import { sendSignInCode, verifySignInCode } from '@/lib/account';
import { getSupabase } from '@/lib/supabase';
import { useSession } from '@/hooks/useSession';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';
import { COLORS } from '@/theme';

const INPUT_CLASS = 'bg-bg-elevated text-white text-base px-4 h-12 rounded-xl';

export default function SignInScreen() {
  const router = useRouter();
  const { available } = useSession();
  const [state, dispatch] = useReducer(otpReducer, INITIAL_OTP_STATE);
  const now = useNow(state.step === 'code');
  const codeRef = useRef<TextInput>(null);

  const send = async () => {
    dispatch({ type: 'sendStarted' });
    const result = await sendSignInCode(getSupabase(), state.email);
    if (result.ok) {
      dispatch({ type: 'sendSucceeded', now: Date.now() });
      setTimeout(() => codeRef.current?.focus(), 100);
    } else {
      dispatch({ type: 'failed', message: result.error.message });
    }
  };

  const verify = async () => {
    dispatch({ type: 'verifyStarted' });
    const result = await verifySignInCode(getSupabase(), state.email, state.code);
    if (result.ok) {
      if (router.canGoBack()) router.back();
      else router.replace('/settings');
    } else {
      dispatch({ type: 'failed', message: result.error.message });
    }
  };

  if (!available) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-muted text-base text-center">
          Hesap özellikleri şu an kapalı.
        </Text>
      </View>
    );
  }

  const secondsLeft = resendSecondsLeft(state, now);

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
        <Card className="gap-3">
          <Text className="text-white text-base leading-6">
            Hesap oluşturursan e-posta adresin ve salon üyeliğin Dinç'in sunucusunda
            saklanır. Antrenmanların şimdilik yalnızca telefonunda kalır.
          </Text>
          <Pressable
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
            hitSlop={6}
            accessibilityRole="link"
            className="self-start active:opacity-60"
          >
            <Text className="text-accent text-sm font-semibold">Gizlilik Politikası →</Text>
          </Pressable>
        </Card>

        <Card className="gap-4">
          <View>
            <Text className="text-muted text-xs mb-2">E-posta</Text>
            <TextInput
              value={state.email}
              onChangeText={(email) => dispatch({ type: 'emailChanged', email })}
              editable={state.step === 'email' && !state.busy}
              placeholder="ornek@eposta.com"
              placeholderTextColor={COLORS.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={() => canSendCode(state) && void send()}
              className={`${INPUT_CLASS} ${state.step === 'code' ? 'opacity-60' : ''}`}
            />
          </View>

          {state.step === 'email' ? (
            <PrimaryButton
              label="Kod gönder"
              disabled={!canSendCode(state)}
              loading={state.busy}
              onPress={() => void send()}
            />
          ) : (
            <>
              <Text className="text-muted text-sm leading-5">
                {normalizeEmail(state.email)} adresine {OTP_LENGTH} haneli bir kod gönderdik.
                Gelmediyse gereksiz klasörüne bak.
              </Text>
              <View>
                <Text className="text-muted text-xs mb-2">Kod</Text>
                <TextInput
                  ref={codeRef}
                  value={state.code}
                  onChangeText={(code) => dispatch({ type: 'codeChanged', code })}
                  editable={!state.busy}
                  placeholder={'0'.repeat(OTP_LENGTH)}
                  placeholderTextColor={COLORS.muted}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={OTP_LENGTH + 2}
                  returnKeyType="done"
                  onSubmitEditing={() => canVerify(state) && void verify()}
                  className={`${INPUT_CLASS} text-2xl tracking-[8px] tabular-nums text-center`}
                />
              </View>
              <PrimaryButton
                label="Giriş yap"
                disabled={!canVerify(state)}
                loading={state.busy}
                onPress={() => void verify()}
              />
              <View className="flex-row gap-2">
                <SecondaryButton
                  label={secondsLeft > 0 ? `Tekrar gönder (${secondsLeft})` : 'Kodu tekrar gönder'}
                  disabled={!canResend(state, now)}
                  onPress={() => void send()}
                  className="flex-1"
                />
                <SecondaryButton
                  label="E-postayı değiştir"
                  disabled={state.busy}
                  onPress={() => dispatch({ type: 'editEmail' })}
                  className="flex-1"
                />
              </View>
            </>
          )}

          {state.error != null && (
            <Text className="text-danger text-sm leading-5">{state.error}</Text>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Geri sayım için saniyede bir güncellenen saat (yalnızca `running` iken) */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}
