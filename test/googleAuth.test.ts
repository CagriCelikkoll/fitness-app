/**
 * Google ile giriş (0.13 Bölüm 4): saf mantık, Supabase çağrısı, giriş
 * ekranı ve gizli anahtar denetimi. Aynı e-postanın aynı hesaba bağlanması
 * gerçek sunucuda: test/integration/googleLink.int.ts.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { KVKK_NOTICE, PRIVACY_NOTICE_VERSION, PRIVACY_POLICY } from '@/content/legal';
import { signInWithGoogle } from '@/lib/account';
import { INITIAL_AUTH_FORM, authFormReducer, canSubmit, canUseGoogle, type AuthFormState } from '@/lib/auth';
import {
  GOOGLE_ERROR_MESSAGES,
  googleErrorOutcome,
  googleNameSuggestion,
  googleResponseOutcome,
  googleWebClientId,
  suggestionError,
} from '@/lib/googleAuth';
import { DISPLAY_NAME_CHARS_ERROR } from '@/lib/profile';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const CODES = { SIGN_IN_CANCELLED: '12501', IN_PROGRESS: 'IN_PROGRESS', PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES' };
const CLIENT_ID = '123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com';

describe('istemci kimliği', () => {
  it('biçimi doğru kimlik kabul, boş ya da bozuk null (düğme görünmez)', () => {
    expect(googleWebClientId(CLIENT_ID)).toBe(CLIENT_ID);
    expect(googleWebClientId(`  ${CLIENT_ID}\n`)).toBe(CLIENT_ID);
    expect(googleWebClientId(undefined)).toBeNull();
    expect(googleWebClientId('')).toBeNull();
    expect(googleWebClientId('GOCSPX-gizli')).toBeNull();
    expect(googleWebClientId('com.googleusercontent.apps.123-abc')).toBeNull();
  });
});

describe('hesap seçicinin sonucu', () => {
  it('başarılı: jeton ve ad; profil fotoğrafı alınmaz', () => {
    const outcome = googleResponseOutcome({
      type: 'success',
      data: { idToken: 'jeton', user: { name: 'Ayşe Yılmaz', photo: 'https://x' } as { name: string } },
    });
    expect(outcome).toEqual({ kind: 'success', idToken: 'jeton', name: 'Ayşe Yılmaz' });
  });

  it('jeton yoksa hata, kapatılırsa vazgeçme', () => {
    expect(googleResponseOutcome({ type: 'success', data: { idToken: null, user: { name: null } } })).toEqual({
      kind: 'error',
      message: GOOGLE_ERROR_MESSAGES.noToken,
    });
    expect(googleResponseOutcome({ type: 'cancelled', data: null })).toEqual({ kind: 'cancelled' });
  });

  it('hata kodları: kapatma / sürüyor sessiz, Play Hizmetleri ayrı mesaj', () => {
    expect(googleErrorOutcome({ code: CODES.SIGN_IN_CANCELLED }, CODES)).toEqual({ kind: 'cancelled' });
    expect(googleErrorOutcome({ code: CODES.IN_PROGRESS }, CODES)).toEqual({ kind: 'cancelled' });
    expect(googleErrorOutcome({ code: CODES.PLAY_SERVICES_NOT_AVAILABLE }, CODES)).toEqual({
      kind: 'error',
      message: GOOGLE_ERROR_MESSAGES.playServices,
    });
    expect(googleErrorOutcome(new Error('DEVELOPER_ERROR'), CODES)).toEqual({
      kind: 'error',
      message: GOOGLE_ERROR_MESSAGES.failed,
    });
    expect(googleErrorOutcome(null, CODES).kind).toBe('error');
  });
});

describe('ad önerisi', () => {
  it('profilde ad yoksa Google adı (boşluklar düzeltilmiş) önerilir', () => {
    expect(googleNameSuggestion({ displayName: null, googleName: '  Ayşe   Yılmaz ', prompted: false })).toBe(
      'Ayşe Yılmaz'
    );
  });

  it('profilde ad varsa, daha önce sorulduysa ya da Google ad vermediyse öneri yok', () => {
    expect(googleNameSuggestion({ displayName: 'Ayşe', googleName: 'Ayşe Yılmaz', prompted: false })).toBeNull();
    expect(googleNameSuggestion({ displayName: null, googleName: 'Ayşe Yılmaz', prompted: true })).toBeNull();
    expect(googleNameSuggestion({ displayName: null, googleName: null, prompted: false })).toBeNull();
    expect(googleNameSuggestion({ displayName: null, googleName: '   ', prompted: false })).toBeNull();
  });

  it('kurala uymayan ad da önerilir, hata gösterilir (kullanıcı düzeltir)', () => {
    const emoji = googleNameSuggestion({ displayName: null, googleName: 'Ayşe 💪', prompted: false });
    expect(emoji).toBe('Ayşe 💪');
    expect(suggestionError(emoji!)).toBe(DISPLAY_NAME_CHARS_ERROR);

    const long = googleNameSuggestion({ displayName: null, googleName: 'A'.repeat(41), prompted: false });
    expect(suggestionError(long!)).toMatch(/en fazla 40/);

    expect(suggestionError('Ayşe Yılmaz')).toBeNull();
    expect(suggestionError("O'Brien-Çelik")).toBeNull();
  });
});

describe('giriş formu', () => {
  const read_: AuthFormState = authFormReducer(INITIAL_AUTH_FORM, { type: 'noticeToggled' });

  it('Google düğmesi yalnızca aydınlatma kutusu işaretliyken (kodla girişle aynı kural)', () => {
    expect(canUseGoogle(INITIAL_AUTH_FORM)).toBe(false);
    expect(canUseGoogle(read_)).toBe(true);
    // e-posta gerekmez
    expect(canSubmit(read_)).toBe(false);
  });

  it('Google sürerken iki düğme de kapalı; vazgeçince hata yok, hata mesajı gösterilir', () => {
    const started = authFormReducer(read_, { type: 'googleStarted' });
    expect(started).toMatchObject({ busy: true, google: true });
    expect(canUseGoogle(started)).toBe(false);
    expect(canSubmit({ ...started, email: 'a@b.co' })).toBe(false);

    expect(authFormReducer(started, { type: 'cancelled' })).toMatchObject({ busy: false, google: false, error: null });
    expect(authFormReducer(started, { type: 'failed', message: 'x' })).toMatchObject({
      busy: false,
      google: false,
      error: 'x',
    });
    // kodla gönderim Google göstergesini açmaz
    expect(authFormReducer(read_, { type: 'started' })).toMatchObject({ busy: true, google: false });
  });

  it('kod adımında Google yok', () => {
    const code = authFormReducer({ ...read_, email: 'a@b.co' }, { type: 'codeSent', now: 1 });
    expect(canUseGoogle(code)).toBe(false);
  });
});

describe('Supabase: signInWithGoogle', () => {
  function fakeClient(result: { data: unknown; error: unknown }) {
    const calls: unknown[] = [];
    const client = {
      auth: {
        signInWithIdToken: async (args: unknown) => {
          calls.push(args);
          return result;
        },
      },
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it('kimlik jetonuyla google sağlayıcısı; kullanıcı kimliği döner', async () => {
    const { client, calls } = fakeClient({ data: { user: { id: 'u1' }, session: {} }, error: null });
    expect(await signInWithGoogle(client, 'jeton')).toEqual({ ok: true, value: 'u1' });
    expect(calls).toEqual([{ provider: 'google', token: 'jeton' }]);
  });

  it('sunucu hatası sınıflandırılır; istemci yoksa ağa çıkmaz', async () => {
    const { client } = fakeClient({ data: { user: null, session: null }, error: { status: 0, message: 'Network request failed' } });
    const failed = await signInWithGoogle(client, 'jeton');
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.kind).toBe('network');

    const none = await signInWithGoogle(null, 'jeton');
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.kind).toBe('not_configured');
  });
});

describe('giriş ekranı (kaynak)', () => {
  const screen = read('app/account/sign-in.tsx');

  it('Google düğmesi e-posta alanının üstünde, aydınlatma kutusu ikisinin de üstünde', () => {
    const checkbox = screen.indexOf('<ConsentCheckbox');
    const google = screen.indexOf('<GoogleSignInButton');
    const email = screen.indexOf('<Field label="E-posta">');
    expect(checkbox).toBeGreaterThan(0);
    expect(checkbox).toBeLessThan(google);
    expect(google).toBeLessThan(email);
    expect(screen).toContain('disabled={!state.noticeRead}');
  });

  it('onay Google girişinden önce cihazda bekletilir (kodla girişteki gibi)', () => {
    const fn = screen.slice(screen.indexOf('const continueWithGoogle'), screen.indexOf('const resend'));
    expect(fn.indexOf('savePendingAck')).toBeGreaterThan(0);
    expect(fn.indexOf('savePendingAck')).toBeLessThan(fn.indexOf('signInWithGoogle('));
  });

  it('karşılamadaki "Hesabım var, giriş yap" aynı ekrana gider', () => {
    expect(read('app/onboarding.tsx')).toContain("router.push('/account/sign-in')");
  });

  it('çıkışta ve hesap silinince Google oturumu da kapanır', () => {
    const settings = read('src/components/settings/SettingsSections.tsx');
    expect(settings.match(/\.then\(\(\) => googleSignOut\(\)\)/g)).toHaveLength(2);
    expect(read('app/account/delete.tsx')).toContain('googleSignOut()');
  });

  it('profil fotoğrafı istenmez, kullanılmaz', () => {
    for (const rel of ['src/lib/googleAuth.ts', 'src/lib/googleSignInNative.ts', 'app/account/sign-in.tsx', 'app/account/name.tsx']) {
      expect(read(rel)).not.toMatch(/\.photo\b|avatar/i);
    }
    expect(read('src/lib/googleSignInNative.ts')).toContain('offlineAccess: false');
  });
});

describe('gizli anahtar ve kimlik depoda yok', () => {
  function files(dir: string): string[] {
    return readdirSync(path.join(root, dir)).flatMap((name) => {
      const rel = path.join(dir, name);
      return statSync(path.join(root, rel)).isDirectory() ? files(rel) : [rel];
    });
  }

  it('client secret (GOCSPX-) ve sabit istemci kimliği yok; kimlik ortam değişkeninden', () => {
    const sources = [...files('src'), ...files('app'), 'app.json', 'app.config.js', 'eas.json'];
    for (const rel of sources) {
      const text = read(rel);
      expect(text, rel).not.toMatch(/GOCSPX-|client_?secret/i);
      expect(text, rel).not.toMatch(/\d+-[a-z0-9]{20,}\.apps\.googleusercontent\.com/);
    }
    expect(read('src/lib/googleSignInNative.ts')).toContain('process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  });
});

describe('aydınlatma metni', () => {
  const text = (doc: { blocks: { kind: string; text?: string; items?: string[] }[] }) =>
    doc.blocks.map((b) => (b.kind === 'paragraph' ? b.text : b.items!.join(' '))).join(' ');

  it('Google ile girişte alınan veriler yazıyor; sürüm 0.13 metniyle arttı', () => {
    expect(text(KVKK_NOTICE)).toContain('Google ile girersen Google hesabındaki adın ve e-posta adresin');
    expect(text(KVKK_NOTICE)).toContain('Google ile girişte kimliğin Google tarafından doğrulanır');
    expect(text(PRIVACY_POLICY)).toContain('profil fotoğrafın alınmaz');
    expect(PRIVACY_NOTICE_VERSION > '2026-11-08').toBe(true);
  });
});
