/**
 * Gerçek sunucu — hesap (v3.2a; v3.7 yalnızca kod). Uygulamanın kendi
 * fonksiyonları (src/lib/account.ts) uygulamadaki auth ayarlarıyla kurulmuş
 * istemciyle. Hiç e-posta gönderilmez: kodlar admin generateLink'ten.
 * Şifre kapatma (DNC-09): authHardening.int.ts.
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import { deleteMyAccount, signOut, verifySignInCode } from '@/lib/account';
import { supabaseTransport } from '@/lib/sync/supabaseTransport';

import {
  PASSWORD,
  admin,
  appClient,
  createUser,
  deleteCreatedUsers,
  emailCode,
  env,
  hasStoredPassword,
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

describe('Hesap: yalnızca kodla giriş ve hesap açma (v3.7)', () => {
  it('yeni hesap: hesabı olmayan adrese kod → hesap açılır, profil var, şifre yok', async () => {
    const email = testEmail('yeni');
    // Uygulamadaki signInWithOtp({ shouldCreateUser: true }) ile aynı yol;
    // magiclink, kullanıcı yoksa kayıt koduna dönüyor (e-posta gönderilmez)
    const { code, userId } = await emailCode({ type: 'magiclink', email });
    track(userId);
    expect(code).toMatch(/^\d{6,8}$/);

    const app = appClient();
    expect(await verifySignInCode(app.client, email, code)).toEqual({ ok: true, value: null });
    const { data } = await app.client.auth.getSession();
    expect(data.session?.user.id).toBe(userId);
    expect(data.session?.user.email_confirmed_at).toBeTruthy();
    expect(await hasStoredPassword(userId)).toBe(false);
    const { data: profile } = await admin.from('profiles').select('id, display_name').eq('id', userId).single();
    expect(profile).toEqual({ id: userId, display_name: null });

    // Aynı kod ikinci kez işe yaramaz
    const again = appClient();
    expect(await verifySignInCode(again.client, email, code)).toMatchObject({
      ok: false,
      error: { kind: 'invalid_otp' },
    });
  });

  it('şifreyle kayıt olmuş eski kullanıcı aynı e-postayla kodla girer, verisi aynı hesapta', async () => {
    // v3.7 öncesi uygulamanın kaydı: e-posta + şifre + doğrulama kodu
    const email = testEmail('eskisifre');
    const signup = await emailCode({ type: 'signup', email, password: PASSWORD });
    track(signup.userId);
    const first = appClient();
    expect(await verifySignInCode(first.client, email, signup.code)).toEqual({ ok: true, value: null });
    await supabaseTransport(first.client).serverTime();
    await signOut(first.client);

    // v3.7: kodla giriş aynı kullanıcıya
    const later = await signedIn({ email });
    expect((await later.client.auth.getSession()).data.session?.user.id).toBe(signup.userId);
  });

  it('kodla giriş (var olan hesap)', async () => {
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
    const { code } = await emailCode({ type: 'magiclink', email: b.email });
    expect(await verifySignInCode(app.client, b.email, code)).toEqual({ ok: true, value: null });
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
