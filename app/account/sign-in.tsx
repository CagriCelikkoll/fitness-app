/**
 * Giriş (v3.0).
 *
 * - Giriş: e-posta + şifre
 * - Hesap oluştur: e-posta + şifre (en az 8, tekrar) → e-postaya 6
 *   haneli doğrulama kodu (Confirm signup şablonu) → kod → giriş
 * - Şifremi unuttum: e-postaya 6 haneli kod (Reset Password şablonu) →
 *   kod + yeni şifre
 * - Kodla giriş yap: şifresiz, e-postaya 6 haneli kod
 *
 * Girişte "e-posta doğrulanmamış" gelirse yeni doğrulama kodu gönderilip
 * kod adımına geçiliyor. Durum mantığı saf: `authFormReducer`
 * (src/lib/auth.ts). "Kodu tekrar gönder" 60 sn sonra açılır.
 *
 * Bayrak kapalıysa / env yoksa ekran açıklama gösterip istek atmaz.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Eye, EyeOff } from 'lucide-react-native';

import {
  ACCOUNT_ERROR_MESSAGES,
  INITIAL_AUTH_FORM,
  OTP_LENGTH,
  PASSWORD_MIN_LENGTH,
  authFormReducer,
  canResend,
  canSubmit,
  emailStepOf,
  isCodeMode,
  normalizeEmail,
  passwordError,
  resendSecondsLeft,
  type AuthFormField,
  type AuthMode,
} from '@/lib/auth';
import {
  resendSignupCode,
  sendPasswordResetCode,
  sendSignInCode,
  signInWithPassword,
  signUpWithPassword,
  updatePassword,
  verifyRecoveryCode,
  verifySignInCode,
  verifySignupCode,
  type AccountResult,
} from '@/lib/account';
import { getSupabase } from '@/lib/supabase';
import { useSession } from '@/hooks/useSession';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';
import { COLORS } from '@/theme';

const INPUT_CLASS = 'bg-bg-elevated text-white text-base px-4 h-12 rounded-xl';

const TITLES: Record<AuthMode, string> = {
  signIn: 'Giriş yap',
  signUp: 'Hesap oluştur',
  verifySignup: 'E-postanı doğrula',
  forgot: 'Şifremi unuttum',
  resetPassword: 'Yeni şifre',
  otpEmail: 'Kodla giriş',
  otpCode: 'Kodla giriş',
};

const SUBMIT_LABELS: Record<AuthMode, string> = {
  signIn: 'Giriş yap',
  signUp: 'Hesap oluştur',
  verifySignup: 'Doğrula ve giriş yap',
  forgot: 'Kod gönder',
  resetPassword: 'Şifreyi kaydet',
  otpEmail: 'Kod gönder',
  otpCode: 'Giriş yap',
};

export default function SignInScreen() {
  const router = useRouter();
  const { available } = useSession();
  const [state, dispatch] = useReducer(authFormReducer, INITIAL_AUTH_FORM);
  const codeMode = isCodeMode(state.mode);
  const now = useNow(codeMode);

  const setField = (field: AuthFormField) => (value: string) =>
    dispatch({ type: 'fieldChanged', field, value });
  const switchMode = (mode: AuthMode) => dispatch({ type: 'switchMode', mode });

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
    switchMode(emailStepOf(state.mode));
  };

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  };

  /** Sonuç başarısızsa hata gösterir; başarılıysa true */
  const check = (result: AccountResult<unknown>): boolean => {
    if (result.ok) return true;
    dispatch({ type: 'failed', message: result.error.message });
    return false;
  };

  const sendCode = async (mode: AuthMode) => {
    const client = getSupabase();
    const result =
      mode === 'verifySignup'
        ? await resendSignupCode(client, state.email)
        : mode === 'resetPassword'
          ? await sendPasswordResetCode(client, state.email)
          : await sendSignInCode(client, state.email);
    if (check(result)) dispatch({ type: 'codeSent', mode, now: Date.now() });
  };

  const submit = async () => {
    if (!canSubmit(state)) return;
    dispatch({ type: 'started' });
    const client = getSupabase();

    switch (state.mode) {
      case 'signIn': {
        const result = await signInWithPassword(client, state.email, state.password);
        if (result.ok) return done();
        if (result.error.kind !== 'email_not_confirmed') return void check(result);
        // Kayıt olmuş ama kodu girmemiş: yeni kod gönder, kod adımına geç
        const resent = await resendSignupCode(client, state.email);
        if (resent.ok) {
          dispatch({
            type: 'codeSent',
            mode: 'verifySignup',
            now: Date.now(),
            info: `${ACCOUNT_ERROR_MESSAGES.email_not_confirmed} Yeni bir doğrulama kodu gönderdik.`,
          });
        } else {
          dispatch({
            type: 'failed',
            message: `${ACCOUNT_ERROR_MESSAGES.email_not_confirmed} ${resent.error.message}`,
          });
        }
        return;
      }
      case 'signUp': {
        const result = await signUpWithPassword(client, state.email, state.password);
        if (!check(result)) return;
        if (result.ok && !result.value.needsVerification) return done();
        dispatch({ type: 'codeSent', mode: 'verifySignup', now: Date.now() });
        return;
      }
      case 'verifySignup':
        if (check(await verifySignupCode(client, state.email, state.code))) done();
        return;
      case 'forgot':
        if (check(await sendPasswordResetCode(client, state.email))) {
          dispatch({ type: 'codeSent', mode: 'resetPassword', now: Date.now() });
        }
        return;
      case 'resetPassword': {
        // Kod tek kullanımlık: doğrulandıysa tekrar denemede yalnızca şifre
        if (!state.recoveryVerified) {
          if (!check(await verifyRecoveryCode(client, state.email, state.code))) return;
          dispatch({ type: 'recoveryVerified' });
        }
        if (!check(await updatePassword(client, state.password))) return;
        Alert.alert('Şifren güncellendi', 'Yeni şifrenle giriş yaptın.');
        return done();
      }
      case 'otpEmail':
        if (check(await sendSignInCode(client, state.email))) {
          dispatch({ type: 'codeSent', mode: 'otpCode', now: Date.now() });
        }
        return;
      case 'otpCode':
        if (check(await verifySignInCode(client, state.email, state.code))) done();
        return;
    }
  };

  const resend = async () => {
    dispatch({ type: 'started' });
    await sendCode(state.mode);
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
  const emailEditable = !codeMode && !state.busy;
  const newPassword = state.mode === 'signUp' || state.mode === 'resetPassword';
  const newPasswordHint =
    state.password.length > 0 ? passwordError(state.password, state.passwordRepeat) : null;
  const showCodeField = codeMode && !(state.mode === 'resetPassword' && state.recoveryVerified);

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
            Hesap oluşturursan e-posta adresin, salon üyeliğin ve antrenmanların (rutinler,
            setler, notlar) Dinç'in sunucusunda saklanır; telefon değişince geri gelir.
            Vücut ölçülerin yalnızca telefonunda kalır.
          </Text>
          <TextLink
            label="Gizlilik Politikası →"
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
          />
        </Card>

        <Card className="gap-4">
          <Text className="text-white text-lg font-semibold tracking-tight">
            {TITLES[state.mode]}
          </Text>

          <Field label="E-posta">
            <TextInput
              ref={emailRef}
              value={state.email}
              onChangeText={setField('email')}
              editable={emailEditable}
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

          {state.mode === 'signIn' && (
            <Field label="Şifre">
              <PasswordInput
                value={state.password}
                onChangeText={setField('password')}
                editable={!state.busy}
                autoComplete="current-password"
                textContentType="password"
                onSubmitEditing={() => void submit()}
              />
            </Field>
          )}

          {showCodeField && (
            <Text className="text-muted text-sm leading-5">
              {state.info != null && `${state.info} `}
              {OTP_LENGTH} haneli kodu{' '}
              <Text className="text-white font-semibold">{normalizeEmail(state.email)}</Text>{' '}
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

          {showCodeField && (
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
                className={`${INPUT_CLASS} text-2xl tracking-[8px] tabular-nums text-center`}
              />
            </Field>
          )}

          {state.mode === 'resetPassword' && state.recoveryVerified && (
            <Text className="text-muted text-sm leading-5">
              Kod doğrulandı. Yeni şifreni kaydet.
            </Text>
          )}

          {newPassword && (
            <>
              <Field label={state.mode === 'signUp' ? 'Şifre' : 'Yeni şifre'}>
                <PasswordInput
                  value={state.password}
                  onChangeText={setField('password')}
                  editable={!state.busy}
                  placeholder={`En az ${PASSWORD_MIN_LENGTH} karakter`}
                  autoComplete="new-password"
                  textContentType="newPassword"
                />
              </Field>
              <Field label="Şifre (tekrar)">
                <PasswordInput
                  value={state.passwordRepeat}
                  onChangeText={setField('passwordRepeat')}
                  editable={!state.busy}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  onSubmitEditing={() => void submit()}
                />
              </Field>
              {newPasswordHint != null && (
                <Text className="text-muted text-xs -mt-2">{newPasswordHint}</Text>
              )}
            </>
          )}

          <PrimaryButton
            label={SUBMIT_LABELS[state.mode]}
            disabled={!canSubmit(state)}
            loading={state.busy}
            onPress={() => void submit()}
          />

          {state.error != null && (
            <Text className="text-danger text-sm leading-5">{state.error}</Text>
          )}

          {codeMode && !(state.mode === 'resetPassword' && state.recoveryVerified) && (
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

        <View className="gap-3 px-1">
          {state.mode === 'signIn' ? (
            <>
              <TextLink label="Şifremi unuttum" onPress={() => switchMode('forgot')} />
              <TextLink
                label="Hesabın yok mu? Hesap oluştur"
                onPress={() => switchMode('signUp')}
              />
              <TextLink label="Kodla giriş yap" onPress={() => switchMode('otpEmail')} />
            </>
          ) : state.mode === 'signUp' ? (
            <TextLink
              label="Zaten hesabın var mı? Giriş yap"
              onPress={() => switchMode('signIn')}
            />
          ) : (
            <TextLink label="← Şifreyle girişe dön" onPress={() => switchMode('signIn')} />
          )}
        </View>
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

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="link"
      className="self-start active:opacity-60"
    >
      <Text className="text-accent text-sm font-semibold">{label}</Text>
    </Pressable>
  );
}

/** Şifre alanı + göster/gizle düğmesi */
function PasswordInput(props: Omit<TextInputProps, 'secureTextEntry'>) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <View className="flex-row items-center bg-bg-elevated rounded-xl">
      <TextInput
        {...props}
        secureTextEntry={!visible}
        placeholderTextColor={COLORS.muted}
        autoCapitalize="none"
        autoCorrect={false}
        className="flex-1 text-white text-base px-4 h-12"
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Şifreyi gizle' : 'Şifreyi göster'}
        className="px-4 h-12 items-center justify-center active:opacity-60"
      >
        <Icon color={COLORS.muted} size={20} />
      </Pressable>
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
