/**
 * Gerçek sunucu — hesap (v3.2a). Uygulamanın kendi fonksiyonları
 * (src/lib/account.ts) uygulamadaki auth ayarlarıyla kurulmuş istemciyle.
 * Hiç e-posta gönderilmez: kodlar admin generateLink'ten.
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import {
  deleteMyAccount,
  signInWithPassword,
  signOut,
  updatePassword,
  verifyRecoveryCode,
  verifySignInCode,
  verifySignupCode,
} from '@/lib/account';
import { supabaseTransport } from '@/lib/sync/supabaseTransport';

import {
  PASSWORD,
  admin,
  appClient,
  createUser,
  deleteCreatedUsers,
  emailCode,
  env,
  serverRowCounts,
  signedIn,
  stopAppClients,
  testEmail,
  track,
} from './support';

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
});

const rawClient = () =>
  createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

describe('Hesap: kayıt, giriş, şifre', () => {
  it('kayıt → e-postadaki kodla doğrulama → giriş (kod admin generateLink ile, e-posta yok)', async () => {
    const email = testEmail('kayit');
    const { code, userId } = await emailCode({ type: 'signup', email, password: PASSWORD });
    track(userId);
    expect(code).toMatch(/^\d{6,8}$/);

    const app = appClient();
    expect(await verifySignupCode(app.client, email, code)).toEqual({ ok: true, value: null });
    const { data } = await app.client.auth.getSession();
    expect(data.session?.user.email).toBe(email);
    expect(data.session?.user.email_confirmed_at).toBeTruthy();

    // Aynı kod ikinci kez işe yaramaz
    const again = appClient();
    expect(await verifySignupCode(again.client, email, code)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_otp' },
    });
  });

  it('yanlış şifre → "E-posta ya da şifre yanlış"; doğru şifre → giriş', async () => {
    const user = await createUser('sifre');
    const app = appClient();
    expect(await signInWithPassword(app.client, user.email, 'yanlis-sifre-1')).toMatchObject({
      ok: false,
      error: { kind: 'invalid_credentials' },
    });
    expect(await signInWithPassword(app.client, user.email, user.password)).toEqual({ ok: true, value: null });
  });

  it('şifremi unuttum: kod → yeni şifre → yeni şifreyle giriş, eskisiyle değil', async () => {
    const user = await createUser('sifirla');
    const { code } = await emailCode({ type: 'recovery', email: user.email });
    const app = appClient();
    expect(await verifyRecoveryCode(app.client, user.email, code)).toEqual({ ok: true, value: null });
    const newPassword = 'Yeni-sifre-456';
    expect(await updatePassword(app.client, newPassword)).toEqual({ ok: true, value: null });
    await signOut(app.client);

    const check = appClient();
    expect(await signInWithPassword(check.client, user.email, user.password)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_credentials' },
    });
    expect(await signInWithPassword(check.client, user.email, newPassword)).toEqual({ ok: true, value: null });
  });

  it('kodla giriş (şifresiz)', async () => {
    const user = await createUser('kodla');
    const { code } = await emailCode({ type: 'magiclink', email: user.email });
    const app = appClient();
    expect(await verifySignInCode(app.client, user.email, code)).toEqual({ ok: true, value: null });
    expect((await app.client.auth.getSession()).data.session?.user.id).toBe(user.id);
  });

  it('yanlış kod → "Kod yanlış ya da süresi dolmuş"', async () => {
    const user = await createUser('yanliskod');
    const app = appClient();
    expect(await verifySignInCode(app.client, user.email, '000000')).toMatchObject({
      ok: false,
      error: { kind: 'invalid_otp' },
    });
  });
});

describe('Hesap: silme ve hesap değiştirme', () => {
  it('silinmiş hesabın oturumuyla çıkış (403) uygulamada hatasız; oturum temizleniyor', async () => {
    const user = await createUser('silcikis');
    const app = await signedIn(user);
    expect(await deleteMyAccount(app.client)).toEqual({ ok: true, value: null });

    expect((await app.client.auth.getSession()).data.session).toBeNull();
    expect(app.storage.data.size).toBe(0);
    const logout = app.calls.find((c) => c.url.includes('/auth/v1/logout'));
    expect(logout).toBeDefined();
    const { data } = await admin.auth.admin.getUserById(user.id);
    expect(data.user).toBeNull();
    expect(Object.values(await serverRowCounts(user.id)).every((n) => n === 0)).toBe(true);
  });

  it('hesap değiştirince istemci yeni oturumu kullanıyor; eski oturum (refresh, getUser) geçersiz', async () => {
    const a = await createUser('degistirA');
    const b = await createUser('degistirB');
    const app = await signedIn(a);
    const old = (await app.client.auth.getSession()).data.session!;
    expect(await signOut(app.client)).toEqual({ ok: true, value: null });

    const before = app.calls.length;
    expect(await signInWithPassword(app.client, b.email, b.password)).toEqual({ ok: true, value: null });
    await supabaseTransport(app.client).serverTime();
    const after = app.calls.slice(before).filter((c) => c.url.includes('/rest/v1/'));
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((c) => c.sub === b.id)).toBe(true);
    expect(app.calls.slice(before).some((c) => c.sub === a.id)).toBe(false);

    // Çıkış sunucuda oturumu kapattı: eski refresh token ve eski oturum işe yaramıyor
    const raw = rawClient();
    expect((await raw.auth.refreshSession({ refresh_token: old.refresh_token })).error).not.toBeNull();
    expect((await raw.auth.getUser(old.access_token)).error).not.toBeNull();
  });

  it('silinen hesabın eski access token’ı: veri yazamıyor, hiçbir şey okuyamıyor', async () => {
    const user = await createUser('eskitoken');
    const app = await signedIn(user);
    const oldToken = (await app.client.auth.getSession()).data.session!.access_token;
    expect(await deleteMyAccount(app.client)).toMatchObject({ ok: true });

    const withOld = createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${oldToken}` } },
    });
    const push = await withOld.rpc('sync_push', {
      p_changes: [{ t: 'routines', id: 'r-eski', at: new Date().toISOString(), row: { name: 'x' } }],
    });
    expect(push.error).not.toBeNull();
    const read = await withOld.from('routines').select('id');
    expect(read.data ?? []).toEqual([]);
    expect(Object.values(await serverRowCounts(user.id)).every((n) => n === 0)).toBe(true);
  });
});
