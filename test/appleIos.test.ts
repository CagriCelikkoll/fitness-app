/**
 * 0.13 Bölüm 5: Apple ile giriş ve iOS hazırlığı.
 * - Apple girişinin saf mantığı ve Supabase çağrısı (nonce)
 * - Google'ın iOS kimliği: uygulamadaki seçim ve `app.config.js`'teki URL
 *   şeması aynı kimlikten, aynı sonuç
 * - iOS ayarları: bundle id'ler, Apple yeteneği, Türkçe metinler, TestFlight
 *   profilleri; Android derlemesi etkilenmez
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { signInWithApple } from '@/lib/account';
import {
  APPLE_CANCEL_CODE,
  APPLE_ERROR_MESSAGES,
  appleCredentialOutcome,
  appleErrorOutcome,
  appleFullName,
  appleNameSuggestion,
  nonceFromBytes,
} from '@/lib/appleAuth';
import { INITIAL_AUTH_FORM, authFormReducer, canSubmit, canUseApple, type AuthFormState } from '@/lib/auth';
import { googleIosClientId, googleIosUrlScheme } from '@/lib/googleAuth';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const json = (f: string) => JSON.parse(read(f));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = any;
const appConfig = createRequire(import.meta.url)('../app.config.js') as (ctx: { config: Base }) => Base;
const base = (): Base => json('app.json').expo;

const IOS_MAIN = '123456789012-iosana0123456789abcdefghijklmn.apps.googleusercontent.com';
const IOS_DAHILI = '123456789012-iostest0123456789abcdefghijklm.apps.googleusercontent.com';
const GOOGLE_PLUGIN = '@react-native-google-signin/google-signin';

afterEach(() => {
  vi.unstubAllEnvs();
});

function config(env: Record<string, string>): Base {
  for (const key of ['APP_VARIANT', 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID_DAHILI']) {
    vi.stubEnv(key, env[key] ?? '');
  }
  return appConfig({ config: base() });
}

function googlePlugin(c: Base): Base {
  return (c.plugins as Base[]).find((p) => Array.isArray(p) && p[0] === GOOGLE_PLUGIN);
}

describe('Apple: saf mantık', () => {
  it('vazgeçmek hata değil; diğer hatalar genel mesaj', () => {
    expect(appleErrorOutcome({ code: APPLE_CANCEL_CODE })).toEqual({ kind: 'cancelled' });
    expect(appleErrorOutcome({ code: 'ERR_REQUEST_FAILED' })).toEqual({ kind: 'error', message: APPLE_ERROR_MESSAGES.failed });
    expect(appleErrorOutcome(null).kind).toBe('error');
  });

  it('jeton yoksa hata; varsa ad Türkçe sırayla (ad soyad), boş parçalar atlanır', () => {
    expect(appleCredentialOutcome({ identityToken: null, fullName: null })).toEqual({
      kind: 'error',
      message: APPLE_ERROR_MESSAGES.noToken,
    });
    expect(
      appleCredentialOutcome({ identityToken: 'jeton', fullName: { givenName: 'Ayşe', familyName: 'Yılmaz' } })
    ).toEqual({ kind: 'success', idToken: 'jeton', name: 'Ayşe Yılmaz' });
    expect(appleFullName({ givenName: ' Ali ', middleName: '', familyName: null })).toBe('Ali');
    // Apple adı yalnızca ilk girişte verir: sonraki girişlerde boş
    expect(appleFullName({ givenName: null, middleName: null, familyName: null })).toBeNull();
    expect(appleFullName(null)).toBeNull();
  });

  it('ad önerisi Google kuralıyla aynı', () => {
    expect(appleNameSuggestion({ displayName: null, appleName: 'Ayşe  Yılmaz', prompted: false })).toBe('Ayşe Yılmaz');
    expect(appleNameSuggestion({ displayName: 'Ayşe', appleName: 'Ayşe Yılmaz', prompted: false })).toBeNull();
    expect(appleNameSuggestion({ displayName: null, appleName: 'Ayşe', prompted: true })).toBeNull();
    expect(appleNameSuggestion({ displayName: null, appleName: null, prompted: false })).toBeNull();
  });

  it('nonce: 32 bayt → 64 onaltılık karakter; az bayt reddedilir', () => {
    const nonce = nonceFromBytes(new Uint8Array(32).map((_, i) => i * 7));
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(() => nonceFromBytes(new Uint8Array(8))).toThrow();
  });
});

describe('Apple: form ve Supabase', () => {
  const read_: AuthFormState = { ...INITIAL_AUTH_FORM, noticeRead: true };

  it('Apple düğmesi yalnızca aydınlatma kutusu işaretliyken; sürerken hepsi kapalı', () => {
    expect(canUseApple(INITIAL_AUTH_FORM)).toBe(false);
    expect(canUseApple(read_)).toBe(true);
    const started = authFormReducer(read_, { type: 'appleStarted' });
    expect(started).toMatchObject({ busy: true, apple: true, google: false });
    expect(canUseApple(started)).toBe(false);
    expect(canSubmit({ ...started, email: 'a@b.co' })).toBe(false);
    expect(authFormReducer(started, { type: 'cancelled' })).toMatchObject({ busy: false, apple: false, error: null });
    expect(authFormReducer(started, { type: 'failed', message: 'x' })).toMatchObject({ busy: false, apple: false, error: 'x' });
  });

  it('signInWithApple: apple sağlayıcısı, jeton ve ham nonce', async () => {
    const calls: unknown[] = [];
    const client = {
      auth: {
        signInWithIdToken: async (args: unknown) => {
          calls.push(args);
          return { data: { user: { id: 'u1' }, session: {} }, error: null };
        },
      },
    } as unknown as SupabaseClient;
    expect(await signInWithApple(client, 'jeton', 'ham-nonce')).toEqual({ ok: true, value: 'u1' });
    expect(calls).toEqual([{ provider: 'apple', token: 'jeton', nonce: 'ham-nonce' }]);
    const none = await signInWithApple(null, 'jeton', 'n');
    expect(!none.ok && none.error.kind).toBe('not_configured');
  });

  it('native modül yalnızca require ile, yalnızca iOS; Apple özeti, Supabase hamı alır', () => {
    const native = read('src/lib/appleSignInNative.ts');
    expect(native).toContain("Platform.OS !== 'ios'");
    expect(native).toContain("require('expo-apple-authentication')");
    expect(native).toMatch(/digestStringAsync\(Crypto\.CryptoDigestAlgorithm\.SHA256, nonce\)/);
    expect(native).toContain('nonce: hashed');
    for (const f of ['src/lib/appleSignInNative.ts', 'src/components/AppleSignInButton.tsx', 'app/account/sign-in.tsx']) {
      expect(read(f), f).not.toMatch(/^import [^;]*from 'expo-apple-authentication'/m);
    }
  });

  it('giriş ekranı: Apple Google\'ın üstünde, aydınlatma kutusu ikisinin de üstünde', () => {
    const screen = read('app/account/sign-in.tsx');
    const checkbox = screen.indexOf('<ConsentCheckbox');
    const apple = screen.indexOf('<AppleSignInButton');
    const google = screen.indexOf('<GoogleSignInButton');
    expect(checkbox).toBeGreaterThan(0);
    expect(checkbox).toBeLessThan(apple);
    expect(apple).toBeLessThan(google);
    const fn = screen.slice(screen.indexOf('const continueWithApple'), screen.indexOf('const finishWithName'));
    expect(fn.indexOf('savePendingAck')).toBeGreaterThan(0);
    expect(fn.indexOf('savePendingAck')).toBeLessThan(fn.indexOf('signInWithApple('));
  });
});

describe('Google iOS kimliği', () => {
  it('kanala göre seçilir; biçimi bozuksa null (düğme yok)', () => {
    expect(googleIosClientId({ internal: false, main: IOS_MAIN, dahili: IOS_DAHILI })).toBe(IOS_MAIN);
    expect(googleIosClientId({ internal: true, main: IOS_MAIN, dahili: IOS_DAHILI })).toBe(IOS_DAHILI);
    expect(googleIosClientId({ internal: true, main: IOS_MAIN, dahili: undefined })).toBeNull();
    expect(googleIosClientId({ internal: false, main: 'GOCSPX-gizli', dahili: null })).toBeNull();
  });

  it('kimlik yoksa config değişmez (Play / Android derlemesi aynı)', () => {
    const c = config({});
    expect(googlePlugin(c)).toBeUndefined();
    expect(c).toEqual(base());
  });

  it('kimlik verilince yalnızca URL şeması eklentisi eklenir; şema uygulamadakiyle aynı', () => {
    const c = config({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: IOS_MAIN, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID_DAHILI: IOS_DAHILI });
    expect(googlePlugin(c)).toEqual([GOOGLE_PLUGIN, { iosUrlScheme: googleIosUrlScheme(IOS_MAIN) }]);
    expect(googleIosUrlScheme(IOS_MAIN)).toBe('com.googleusercontent.apps.123456789012-iosana0123456789abcdefghijklmn');
    const { plugins: _p, ...rest } = c;
    const { plugins: _b, ...baseRest } = base();
    expect(rest).toEqual(baseRest);
  });

  it('Dinç Test kendi kimliğini kullanır, Play kimliğine düşmez', () => {
    const c = config({
      APP_VARIANT: 'dahili',
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: IOS_MAIN,
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID_DAHILI: IOS_DAHILI,
    });
    expect(googlePlugin(c)[1].iosUrlScheme).toBe(googleIosUrlScheme(IOS_DAHILI));
    expect(googlePlugin(config({ APP_VARIANT: 'dahili', EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: IOS_MAIN }))).toBeUndefined();
  });

  it('bozuk kimlik derlemeyi durdurur (sessizce şemasız derlenmez)', () => {
    expect(() => config({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'com.googleusercontent.apps.123-abc' })).toThrow(/biçimi bozuk/);
  });

  it('iOS istemci kimliği uygulamaya yalnızca ortam değişkeninden girer', () => {
    const native = read('src/lib/googleSignInNative.ts');
    expect(native).toContain('process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,');
    expect(native).toContain('process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID_DAHILI');
    expect(native).toContain('isInternalChannel(Updates.channel)');
    expect(read('app.config.js') + JSON.stringify(base())).not.toMatch(/\d{6,}-[a-z0-9]+\.apps\.googleusercontent\.com/);
  });
});

describe('iOS ayarları', () => {
  it('bundle id: Dinç ve Dinç Test', () => {
    expect(config({}).ios.bundleIdentifier).toBe('com.dincapp.antrenman');
    expect(config({ APP_VARIANT: 'dahili' }).ios.bundleIdentifier).toBe('com.dincapp.antrenman.dahili');
  });

  it('Apple ile giriş yeteneği ve eklentisi; iki varyantta da', () => {
    for (const c of [config({}), config({ APP_VARIANT: 'dahili' })]) {
      expect(c.ios.usesAppleSignIn).toBe(true);
      expect(c.plugins).toContain('expo-apple-authentication');
    }
  });

  it('iOS metinleri Türkçe; sistem düğmeleri (Apple, paylaşım) Türkçe görünsün', () => {
    const ios = base().ios;
    expect(ios.infoPlist.CFBundleDevelopmentRegion).toBe('tr');
    expect(ios.infoPlist.CFBundleLocalizations).toEqual(['tr']);
    // Paylaşım sayfasında "Görüntüyü kaydet": metin yoksa uygulama kapanır
    expect(ios.infoPlist.NSPhotoLibraryAddUsageDescription).toMatch(/Paylaşım kartını/);
    const plugins = base().plugins as Base[];
    const opts = (name: string) => plugins.find((p) => Array.isArray(p) && p[0] === name)[1];
    expect(opts('expo-image-picker').photosPermission).toMatch(/fotoğraflarına/);
    expect(opts('expo-camera').cameraPermission).toMatch(/QR/);
    // Mikrofon ve Face ID istenmez
    expect(opts('expo-camera').microphonePermission).toBe(false);
    expect(opts('expo-image-picker').microphonePermission).toBe(false);
    expect(opts('expo-audio').microphonePermission).toBe(false);
    expect(opts('expo-secure-store').faceIDPermission).toBe(false);
  });

  it('eas.json: iOS mağaza (TestFlight) profilleri; Android ayarları aynı', () => {
    const eas = json('eas.json');
    expect(eas.build.production.ios).toEqual({ distribution: 'store' });
    expect(eas.build.dahili.ios).toEqual({ distribution: 'store', autoIncrement: true });
    expect(eas.build.dahili.distribution).toBe('internal');
    expect(eas.build.dahili.android).toEqual({ buildType: 'apk' });
    expect(eas.build.production.android).toEqual({ buildType: 'app-bundle' });
  });

  it('eas.json submit: iOS yer tutucusu boş; anahtar ya da kimlik projede yok', () => {
    const submit = json('eas.json').submit;
    expect(submit.production.ios).toEqual({});
    expect(submit.dahili.ios).toEqual({});
    expect(JSON.stringify(submit)).not.toMatch(/\.p8|ascApiKey|appleId|appleTeamId/);
  });
});
