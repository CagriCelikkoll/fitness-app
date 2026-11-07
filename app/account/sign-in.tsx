/**
 * Giriş ve hesap açma (v3.0; v3.7'den beri yalnızca kodla).
 *
 * E-posta → e-postaya 6 haneli kod → giriş. Hesabı olmayana aynı kodla
 * hesap açılır. Şifre yok (pentest DNC-09; sunucuda da kapalı).
 *
 * "Kodu gönder"in üstünde Aydınlatma Metni ve Gizlilik Politikası
 * bağlantıları ve "Aydınlatma Metni'ni okudum." kutusu: işaretlenmeden kod
 * gönderilmez. Bu bilgilendirmenin kaydı, açık rıza değil. Onay cihazda
 * bekleyen olarak bırakılır, giriş yapılınca sunucuya yazılır
 * (`usePrivacyAckSync`).
 *
 * Supabase istemcisi bu ekran açılınca kurulur (hesapsız kullanıcıda
 * başka hiçbir yerde kurulmuyor). Durum mantığı saf: `authFormReducer`
 * (src/lib/auth.ts). "Kodu tekrar gönder" 60 sn sonra açılır.
 *
 * `next=join-gym`: Ayarlar'daki "Salon koduyla katıl"dan gelindiyse giriş
 * sonrası salon kodu ekranı.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import {
  INITIAL_AUTH_FORM,
  OTP_LENGTH,
  authFormReducer,
  canResend,
  canSubmit,
  normalizeEmail,
  resendSecondsLeft,
  type AuthFormField,
} from '@/lib/auth';
import { sendSignInCode, verifySignInCode, type AccountResult } from '@/lib/account';
import {
  PRIVACY_NOTICE_CHECKBOX,
  PRIVACY_NOTICE_VERSION,
  savePendingAck,
} from '@/lib/privacyNotice';
import { getSupabase } from '@/lib/supabase';
import { startAccountClient, useSession } from '@/hooks/useSession';
import { useColors } from '@/hooks/useTheme';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';
import { ConsentCheckbox } from '@/components/ConsentCard';
import { LegalLink } from '@/components/LegalLink';
import { TextLink } from '@/components/TextLink';

const INPUT_CLASS = 'bg-bg-elevated text-fg text-base px-4 h-12 rounded-xl';

export default function SignInScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { available } = useSession();
  const [state, dispatch] = useReducer(authFormReducer, INITIAL_AUTH_FORM);
  const codeMode = state.mode === 'code';
  const now = useNow(codeMode);

  // İstemci yalnızca burada (ve kayıtlı oturum varsa açılışta) kurulur
  useEffect(() => {
    if (available) startAccountClient();
  }, [available]);

  const setField = (field: AuthFormField) => (value: string) =>
    dispatch({ type: 'fieldChanged', field, value });

  // "düzelt": e-posta adımına dön ve alanı odakla. Alan kod adımında
  // düzenlenemez durumda; odak, adım değişip alan açıldıktan sonra.
  const emailRef = useRef<TextInput>(null);
  const focusEmailNext = useRef(false);
  useEffect(() => {
    if (codeMode || !focusEmailNext.current) return;
    focusEmailNext.current = false;
    emailRef.current?.focus();
  }, [codeMode]);
  const editEmail = () => {
    focusEmailNext.current = true;
    dispatch({ type: 'editEmail' });
  };

  const done = () => {
    if (next === 'join-gym') return router.replace('/account/join-gym');
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  };

  /** Sonuç başarısızsa hata gösterir; başarılıysa true */
  const check = (result: AccountResult<unknown>): boolean => {
    if (result.ok) return true;
    dispatch({ type: 'failed', message: result.error.message });
    return false;
  };

  const sendCode = async () => {
    if (check(await sendSignInCode(getSupabase(), state.email))) {
      dispatch({ type: 'codeSent', now: Date.now() });
    }
  };

  const submit = async () => {
    if (!canSubmit(state)) return;
    dispatch({ type: 'started' });
    if (state.mode === 'email') return sendCode();
    // Onay giriş yapılınca sunucuya yazılır (usePrivacyAckSync); kod
    // doğrulanmadan önce bırakılıyor ki oturum açılır açılmaz bulunsun
    await savePendingAck(Storage, PRIVACY_NOTICE_VERSION);
    if (check(await verifySignInCode(getSupabase(), state.email, state.code))) done();
  };

  const resend = async () => {
    dispatch({ type: 'started' });
    await sendCode();
  };

  if (!available) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-muted text-base text-center">
          Hesap özellikleri bu sürümde kullanılamıyor.
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
          <Text className="text-fg text-base leading-6">
            Hesap açarsan e-posta adresin, salon üyeliğin ve antrenmanların (rutinler,
            setler, notlar) Dinç'in sunucusunda saklanır; telefon değişince geri gelir.
            Vücut ölçülerin yalnızca telefonunda kalır.
          </Text>
          <Text className="text-muted text-sm leading-5">
            Şifre yok: her girişte e-postana 6 haneli bir kod gelir. Hesabın yoksa aynı kodla
            açılır.
          </Text>
        </Card>

        <Card className="gap-4">
          <Text className="text-fg text-lg font-semibold tracking-tight">
            {codeMode ? 'Kodu gir' : 'Giriş yap ya da hesap aç'}
          </Text>

          <Field label="E-posta">
            <TextInput
              ref={emailRef}
              value={state.email}
              onChangeText={setField('email')}
              editable={!codeMode && !state.busy}
              placeholder="ornek@eposta.com"
              placeholderTextColor={COLORS.muted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              className={`${INPUT_CLASS} ${codeMode ? 'opacity-60' : ''}`}
            />
          </Field>

          {!codeMode && (
            <View className="gap-2">
              <Text className="text-muted text-sm leading-5">
                Kod göndermeden önce hesabınla ilgili bilgilerin nasıl işlendiğini oku.
              </Text>
              <TextLink
                label="Aydınlatma Metni →"
                onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'kvkk' } })}
              />
              <LegalLink to="privacy" label="Gizlilik Politikası →" />
              <View className="mt-1">
                <ConsentCheckbox
                  checked={state.noticeRead}
                  label={PRIVACY_NOTICE_CHECKBOX}
                  onToggle={() => dispatch({ type: 'noticeToggled' })}
                />
              </View>
            </View>
          )}

          {codeMode && (
            <Text className="text-muted text-sm leading-5">
              {OTP_LENGTH} haneli kodu{' '}
              <Text className="text-fg font-semibold">{normalizeEmail(state.email)}</Text>{' '}
              adresine gönderdik. Adres yanlışsa{' '}
              <Text
                onPress={state.busy ? undefined : editEmail}
                accessibilityRole="link"
                className="text-accent font-semibold"
              >
                düzelt
              </Text>
              . Gelmediyse gereksiz klasörüne bak.
            </Text>
          )}

          {codeMode && (
            <Field label="Kod">
              <TextInput
                value={state.code}
                onChangeText={setField('code')}
                editable={!state.busy}
                placeholder={'0'.repeat(OTP_LENGTH)}
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={OTP_LENGTH + 2}
                autoFocus
                onSubmitEditing={() => void submit()}
                className={`${INPUT_CLASS} text-2xl tracking-[8px] tabular-nums text-center`}
              />
            </Field>
          )}

          <PrimaryButton
            label={codeMode ? 'Giriş yap' : 'Kodu gönder'}
            disabled={!canSubmit(state)}
            loading={state.busy}
            onPress={() => void submit()}
          />

          {state.error != null && (
            <Text className="text-danger text-sm leading-5">{state.error}</Text>
          )}

          {codeMode && (
            <View className="flex-row gap-2">
              <SecondaryButton
                label={secondsLeft > 0 ? `Tekrar gönder (${secondsLeft})` : 'Kodu tekrar gönder'}
                disabled={!canResend(state, now)}
                onPress={() => void resend()}
                className="flex-1"
              />
              <SecondaryButton
                label="E-postayı değiştir"
                disabled={state.busy}
                onPress={editEmail}
                className="flex-1"
              />
            </View>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="text-muted text-xs mb-2">{label}</Text>
      {children}
    </View>
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
