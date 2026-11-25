/**
 * Gerçek sunucu — Google ile giriş ve aynı e-postanın aynı hesaba
 * bağlanması (0.13 Bölüm 4).
 *
 * Google'ın kimlik jetonu taklit edilemez (Supabase Google'ın anahtarıyla
 * doğruluyor); bu yüzden test, elle alınmış gerçek bir jetonla çalışır:
 * `.env.test` → `GOOGLE_TEST_ID_TOKEN` (yaklaşık 1 saat geçerli). Jeton
 * yoksa ya da süresi dolduysa test atlanır ve nedeni yazılır.
 *
 * Senaryo: jetondaki e-postayla önce kodla hesap açılır (uygulamanın
 * `verifySignInCode`'u), sonra aynı e-postanın Google jetonuyla
 * `signInWithGoogle`. Beklenen: aynı kullanıcı kimliği, hesapta hem
 * `email` hem `google` kimliği, şifre yok, Google'daki ad profile yazılmamış.
 *
 * Jetondaki e-postayla test projesinde zaten bir hesap varsa test DURUR
 * (o hesabı silmez); önce panelden sil.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signInWithGoogle, signOut } from '@/lib/account';
import { fetchMyDisplayName } from '@/lib/profile';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseEnvText, ROOT } from './guard.mjs';
import { admin, appClient, deleteCreatedUsers, hasStoredPassword, signedIn, stopAppClients, track } from './support';

function readToken(): string | null {
  if (process.env.GOOGLE_TEST_ID_TOKEN) return process.env.GOOGLE_TEST_ID_TOKEN.trim();
  try {
    return parseEnvText(readFileSync(path.join(ROOT, '.env.test'), 'utf8')).GOOGLE_TEST_ID_TOKEN?.trim() || null;
  } catch {
    return null;
  }
}

interface GoogleClaims {
  email?: string;
  email_verified?: boolean;
  exp?: number;
  iss?: string;
}

function claimsOf(token: string): GoogleClaims | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as GoogleClaims;
  } catch {
    return null;
  }
}

const token = readToken();
const claims = token ? claimsOf(token) : null;
const skipReason = !token
  ? '.env.test içinde GOOGLE_TEST_ID_TOKEN yok'
  : !claims?.email
    ? 'GOOGLE_TEST_ID_TOKEN çözülemedi'
    : !String(claims.iss ?? '').includes('accounts.google.com')
      ? 'GOOGLE_TEST_ID_TOKEN Google jetonu değil'
      : (claims.exp ?? 0) * 1000 < Date.now() + 60_000
        ? 'GOOGLE_TEST_ID_TOKEN süresi dolmuş, yenisini al'
        : null;

if (skipReason) console.warn(`[googleLink] atlandı: ${skipReason}`);

describe.skipIf(skipReason != null)('Google ile giriş: aynı e-posta aynı hesap', () => {
  const email = claims?.email?.toLowerCase() ?? '';
  let codeUserId: string;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(error.message);
    if (data.users.some((u) => u.email?.toLowerCase() === email)) {
      throw new Error('Jetondaki e-postayla test projesinde hesap zaten var; panelden silip tekrar çalıştır.');
    }
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`Kullanıcı açılamadı: ${created.error?.message}`);
    track(created.data.user.id);
  });

  afterAll(async () => {
    await stopAppClients();
    await deleteCreatedUsers();
  });

  it('kodla açılan hesaba Google ile girince aynı kullanıcı', async () => {
    // 1. Kodla giriş (uygulamanın akışı)
    const coded = await signedIn({ email });
    const { data: me } = await coded.client.auth.getUser();
    codeUserId = me.user!.id;
    await signOut(coded.client);

    // 2. Aynı e-posta, Google jetonu
    const app = appClient();
    const result = await signInWithGoogle(app.client, token!);
    if (!result.ok) throw new Error(`Google girişi başarısız: ${result.error.kind} ${result.error.message}`);
    if (result.value !== codeUserId) {
      track(result.value);
      throw new Error(
        `AYRI HESAP AÇILDI: kodla ${codeUserId}, Google ile ${result.value}. Kimlik bağlama çalışmıyor; dur ve sor.`
      );
    }
    expect(result.value).toBe(codeUserId);

    const { data: session } = await app.client.auth.getSession();
    expect(session.session?.user.id).toBe(codeUserId);
  });

  it('hesapta iki kimlik (email + google), şifre yok, Google adı profile yazılmadı', async () => {
    const { data, error } = await admin.auth.admin.getUserById(codeUserId);
    if (error) throw new Error(error.message);
    const providers = (data.user.identities ?? []).map((i) => i.provider).sort();
    expect(providers).toEqual(['email', 'google']);
    expect(await hasStoredPassword(codeUserId)).toBe(false);

    // DNC-04: kayıttaki kullanıcı verisi (Google'ın full_name'i) profile geçmez
    const app = appClient();
    const again = await signInWithGoogle(app.client, token!);
    expect(again.ok && again.value).toBe(codeUserId);
    const name = await fetchMyDisplayName(app.client, codeUserId);
    expect(name).toEqual({ ok: true, value: null });
  });
});
