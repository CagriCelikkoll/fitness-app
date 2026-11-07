/**
 * Gerçek sunucu — v3.7 güvenlik (supabase/migrations/0014_auth_hardening.sql).
 *
 * DNC-09 (pentest, yüksek): saldırgan kurbanın e-postasıyla şifreli kayıt
 * açar; kurban sonra kodla girince aynı hesap doğrulanır ve saldırganın
 * şifresi geçerli kalırdı. Şimdi auth.users'a yazılan her şifre boşaltılıyor:
 * kurban girdikten sonra `grant_type=password` başarısız.
 *
 * Şifreli kayıt: test projesinde "Confirm email" kapalıysa doğrudan
 * `/auth/v1/signup` (e-posta gitmez). Açıksa /signup kurbanın adresine
 * gerçek bir doğrulama e-postası gönderir; testler e-posta göndermiyor,
 * o yüzden aynı GoTrue kayıt yolu (şifreyle kullanıcı oluşturma) admin
 * `generateLink({ type: 'signup', password })` ile.
 *
 * Aydınlatma onayı: ack_privacy_notice / my_privacy_ack; salon personeli
 * üyenin onay sütunlarını göremez.
 */

import { randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifySignInCode } from '@/lib/account';
import { fetchMyDisplayName } from '@/lib/profile';
import { ackPrivacyNotice, fetchPrivacyAck, PRIVACY_NOTICE_VERSION } from '@/lib/privacyNotice';

import {
  PASSWORD,
  admin,
  appClient,
  createUser,
  deleteCreatedUsers,
  emailCode,
  env,
  hasStoredPassword,
  signedIn,
  stopAppClients,
  testEmail,
  track,
  type AppClient,
  type TestUser,
} from './support';

afterAll(async () => {
  await stopAppClients();
  await deleteCreatedUsers();
  if (gymId) await admin.from('gyms').delete().eq('id', gymId);
});

async function authSettings(): Promise<{ mailer_autoconfirm?: boolean }> {
  const r = await fetch(`${env.url}/auth/v1/settings`, { headers: { apikey: env.anonKey } });
  return (await r.json()) as { mailer_autoconfirm?: boolean };
}

/** Saldırganın yapacağı gibi doğrudan şifreyle giriş (uygulamada artık yok) */
async function passwordLogin(email: string, password: string) {
  const r = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await r.json()) as { access_token?: string; error_code?: string; user?: { id: string } };
  return { status: r.status, body };
}

/** Saldırganın şifreli kaydı; kullanıcı kimliği */
async function attackerSignup(email: string): Promise<string> {
  if ((await authSettings()).mailer_autoconfirm) {
    const r = await fetch(`${env.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, data: { display_name: 'Kurban' } }),
    });
    const body = (await r.json()) as { id?: string; user?: { id: string } };
    const id = body.user?.id ?? body.id;
    if (!r.ok || !id) throw new Error(`signup: ${r.status} ${JSON.stringify(body)}`);
    return id;
  }
  const { userId } = await emailCode({ type: 'signup', email, password: PASSWORD });
  return userId;
}

describe('DNC-09: hesabın sahibinden önce ele geçirilmesi', () => {
  it('şifreli kayıt → kurban kodla girer (aynı hesap) → saldırganın şifresiyle giriş BAŞARISIZ', async () => {
    const email = testEmail('dnc09');
    const victimId = await attackerSignup(email);
    track(victimId);

    // Şifre daha kayıtta boşaltıldı
    expect(await hasStoredPassword(victimId)).toBe(false);

    // Kurban uygulamada kodla girer: aynı kayıt doğrulanır
    const victim = await signedIn({ email });
    expect((await victim.client.auth.getSession()).data.session?.user.id).toBe(victimId);

    // Saldırgan kendi şifresiyle dener
    const login = await passwordLogin(email, PASSWORD);
    expect(login.status).toBe(400);
    expect(login.body.error_code).toBe('invalid_credentials');
    expect(login.body.access_token).toBeUndefined();
    expect(await hasStoredPassword(victimId)).toBe(false);

    // Saldırganın kayıtta gönderdiği ad profile geçmedi
    expect(await fetchMyDisplayName(victim.client, victimId)).toEqual({ ok: true, value: null });
  });

  it('giriş yapmış kullanıcı updateUser({ password }) ile şifre koyamaz', async () => {
    const user = await createUser('sifrekoy');
    const app = await signedIn(user);
    // supabase-js hata vermeyebilir (sunucu boşaltıyor); önemli olan sonuç
    await app.client.auth.updateUser({ password: 'Yeni-sifre-456' });
    expect(await hasStoredPassword(user.id)).toBe(false);
    expect((await passwordLogin(user.email, 'Yeni-sifre-456')).status).toBe(400);
  });

  it('yönetici API\'siyle şifreli açılan hesapta da şifre yok', async () => {
    const email = testEmail('adminsifre');
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    track(data.user.id);
    expect(await hasStoredPassword(data.user.id)).toBe(false);
    expect((await passwordLogin(email, PASSWORD)).status).toBe(400);
  });

  it('normal kodla giriş ve yeni hesap açma eskisi gibi (account.int.ts ayrıntılı)', async () => {
    const email = testEmail('normal');
    const { code, userId } = await emailCode({ type: 'magiclink', email });
    track(userId);
    const app = appClient();
    expect(await verifySignInCode(app.client, email, code)).toEqual({ ok: true, value: null });
    expect((await app.client.auth.getSession()).data.session?.user.id).toBe(userId);
  });
});

// ============================================================================
// Aydınlatma metni onayı
// ============================================================================

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let gymId: string | null = null;
let member: TestUser;
let staff: TestUser;
let m: AppClient;
let s: AppClient;

beforeAll(async () => {
  const { data, error } = await admin
    .from('gyms')
    .insert({
      name: 'INT Aydinlatma',
      join_code: Array.from(randomBytes(8))
        .map((b) => ALPHABET[b % ALPHABET.length])
        .join(''),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  gymId = data.id as string;
  member = await createUser('aydinlatma-uye');
  staff = await createUser('aydinlatma-hoca');
  await admin.from('gym_members').insert([
    { gym_id: gymId, user_id: member.id, role: 'member' },
    { gym_id: gymId, user_id: staff.id, role: 'admin' },
  ]);
  m = await signedIn(member);
  s = await signedIn(staff);
});

describe('Aydınlatma metni onayı', () => {
  it('başta yok; onaylanınca sürüm ve sunucu saati yazılır', async () => {
    expect(await fetchPrivacyAck(m.client)).toEqual({ ok: true, value: { version: null, ackAt: null } });
    const before = Date.now();
    expect(await ackPrivacyNotice(m.client)).toEqual({ ok: true, value: null });
    const r = await fetchPrivacyAck(m.client);
    if (!r.ok) throw new Error(r.error.kind);
    expect(r.value.version).toBe(PRIVACY_NOTICE_VERSION);
    expect(Math.abs(new Date(r.value.ackAt!).getTime() - before)).toBeLessThan(5 * 60_000);
  });

  it('geçersiz sürüm reddedilir', async () => {
    expect(await ackPrivacyNotice(m.client, 'evet')).toMatchObject({ ok: false, error: { kind: 'invalid_input' } });
  });

  it('istemci sütuna doğrudan yazamaz; yalnızca RPC', async () => {
    const r = await m.client.from('profiles').update({ privacy_version: '2099-01-01' }).eq('id', member.id).select('id');
    expect(r.error?.code).toBe('42501');
  });

  it('salon yöneticisi üyenin adını görür ama onay sütunlarını göremez', async () => {
    await admin.from('profiles').update({ display_name: 'Üye Aydın' }).eq('id', member.id);
    const name = await s.client.from('profiles').select('display_name').eq('id', member.id);
    expect(name.data).toEqual([{ display_name: 'Üye Aydın' }]);
    const hidden = await s.client.from('profiles').select('privacy_version, privacy_ack_at').eq('id', member.id);
    expect(hidden.error?.code).toBe('42501');
  });

  it('girişsiz çağrı reddedilir', async () => {
    const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.rpc('ack_privacy_notice', { p_version: PRIVACY_NOTICE_VERSION })).error).not.toBeNull();
    expect((await anon.rpc('my_privacy_ack')).error).not.toBeNull();
  });
});
