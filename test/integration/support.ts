/**
 * Entegrasyon testlerinin ortak yardımcıları (v3.2a).
 *
 * - Kullanıcılar admin API ile, e-postası onaylı açılır: HİÇ e-posta
 *   gönderilmez. Kod isteyen akışlarda kod admin `generateLink` ile alınır
 *   (o da e-posta göndermez).
 * - Uygulama istemcisi uygulamadaki auth ayarlarıyla kurulur
 *   (`supabaseAuthOptions`, bellek deposu); istekler sayılır ve hangi
 *   token'la gittikleri kaydedilir.
 * - Service role YALNIZCA burada (test projesi) kullanılır: kullanıcı
 *   açma/silme, salon tohumlama, sunucudaki gerçek durumu okuma.
 */

import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { verifySignInCode } from '@/lib/account';
import { supabaseAuthOptions, type SessionStorage } from '@/lib/supabaseConfig';

import { TEST_EMAIL_PREFIX } from './globalSetup';
import { loadTestEnv } from './guard.mjs';

export const env = loadTestEnv();

export const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * v3.7: sunucuda şifre kapalı (0014). Yalnızca DNC-09 testlerinde
 * "saldırganın şifresi" olarak ve generateLink signup'ın zorunlu alanı
 * olarak kullanılıyor; hiçbir hesapta geçerli değil.
 */
export const PASSWORD = 'Gizli-sifre-123';

export interface TestUser {
  id: string;
  email: string;
}

const created: string[] = [];

export function testEmail(label: string): string {
  return `${TEST_EMAIL_PREFIX}${label}-${randomUUID().slice(0, 8)}@example.com`;
}

/** Onaylı, şifresiz kullanıcı (e-posta yok) */
export async function createUser(label: string): Promise<TestUser> {
  const email = testEmail(label);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`Kullanıcı açılamadı: ${error?.message}`);
  created.push(data.user.id);
  return { id: data.user.id, email };
}

/** Test sonunda: açılan bütün kullanıcılar (verileri cascade ile gider) */
export async function deleteCreatedUsers(): Promise<void> {
  for (const id of created.splice(0)) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

export function track(id: string): void {
  created.push(id);
}

export function memoryStorage(): SessionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

export interface RecordedCall {
  url: string;
  method: string;
  /** Authorization başlığındaki token'ın sahibi (JWT sub) ya da 'anon' */
  sub: string | null;
  token: string | null;
}

export interface AppClient {
  client: SupabaseClient;
  storage: ReturnType<typeof memoryStorage>;
  calls: RecordedCall[];
}

function subOf(token: string | null): string | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return 'anon';
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { sub?: string };
    return payload.sub ?? 'anon';
  } catch {
    return 'anon';
  }
}

const appClients: SupabaseClient[] = [];

/** Uygulamadaki gibi kurulmuş istemci; bütün istekleri kaydediyor */
export function appClient(): AppClient {
  const calls: RecordedCall[] = [];
  const recordingFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const auth = headers.get('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    calls.push({ url: String(input), method: init?.method ?? 'GET', sub: subOf(token), token });
    return fetch(input, init);
  };
  const storage = memoryStorage();
  const client = createClient(env.url, env.anonKey, {
    auth: supabaseAuthOptions(storage),
    global: { fetch: recordingFetch as typeof fetch },
  });
  appClients.push(client);
  return { client, storage, calls };
}

export async function stopAppClients(): Promise<void> {
  for (const c of appClients.splice(0)) await c.auth.stopAutoRefresh();
}

/**
 * Uygulamanın giriş fonksiyonuyla (v3.7: yalnızca kod) giriş yapmış
 * istemci. Kod admin generateLink'ten; e-posta gönderilmez.
 */
export async function signedIn(user: Pick<TestUser, 'email'>): Promise<AppClient> {
  const app = appClient();
  const { code } = await emailCode({ type: 'magiclink', email: user.email });
  const r = await verifySignInCode(app.client, user.email, code);
  if (!r.ok) throw new Error(`${user.email} giriş yapamadı: ${r.error.kind}`);
  return app;
}

/**
 * auth.users'ta şifre tanımlı mı (DNC-09). REST auth şemasını göstermiyor;
 * test projesinin veritabanına doğrudan, yalnızca okuyarak bakılır.
 */
export async function hasStoredPassword(userId: string): Promise<boolean> {
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const r = await db.query<{ has: boolean }>(
      "select coalesce(encrypted_password, '') <> '' as has from auth.users where id = $1",
      [userId]
    );
    if (r.rows.length !== 1) throw new Error(`auth.users satırı yok: ${userId}`);
    return r.rows[0]!.has;
  } finally {
    await db.end().catch(() => {});
  }
}

/** Admin `generateLink` ile e-posta GÖNDERMEDEN 6 haneli kod */
export async function emailCode(
  params:
    | { type: 'signup'; email: string; password: string }
    | { type: 'recovery' | 'magiclink'; email: string }
): Promise<{ code: string; userId: string }> {
  const { data, error } = await admin.auth.admin.generateLink(params);
  if (error || !data.properties?.email_otp) {
    throw new Error(`Kod alınamadı (${params.type}): ${error?.message}`);
  }
  return { code: data.properties.email_otp, userId: data.user.id };
}

/** Sunucudaki gerçek durum (service role, RLS'siz): kullanıcıya ait satır sayıları */
export const USER_TABLES = [
  ['profiles', 'id'],
  ['gym_members', 'user_id'],
  ['gym_join_attempts', 'user_id'],
  ['routines', 'user_id'],
  ['routine_exercises', 'user_id'],
  ['workout_sessions', 'user_id'],
  ['session_exercises', 'user_id'],
  ['sets', 'user_id'],
  ['cardio_segments', 'user_id'],
  ['class_rsvps', 'user_id'],
  ['push_tokens', 'user_id'],
  ['notification_prefs', 'user_id'],
  ['trainer_students', 'student_id'],
  ['program_assignments', 'student_id'],
  ['gym_visits', 'user_id'],
  ['gym_feedback', 'author_id'],
] as const;

export async function serverRowCounts(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [table, column] of USER_TABLES) {
    const { count, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, userId);
    if (error) throw new Error(`${table} okunamadı: ${error.message}`);
    out[table] = count ?? 0;
  }
  return out;
}
