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

import { signInWithPassword } from '@/lib/account';
import { supabaseAuthOptions, type SessionStorage } from '@/lib/supabaseConfig';

import { TEST_EMAIL_PREFIX } from './globalSetup';
import { loadTestEnv } from './guard.mjs';

export const env = loadTestEnv();

export const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const PASSWORD = 'Gizli-sifre-123';

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

const created: string[] = [];

export function testEmail(label: string): string {
  return `${TEST_EMAIL_PREFIX}${label}-${randomUUID().slice(0, 8)}@example.com`;
}

/** Onaylı kullanıcı (e-posta yok) */
export async function createUser(label: string): Promise<TestUser> {
  const email = testEmail(label);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Kullanıcı açılamadı: ${error?.message}`);
  created.push(data.user.id);
  return { id: data.user.id, email, password: PASSWORD };
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

/** Uygulamanın giriş fonksiyonuyla giriş yapmış istemci */
export async function signedIn(user: TestUser): Promise<AppClient> {
  const app = appClient();
  const r = await signInWithPassword(app.client, user.email, user.password);
  if (!r.ok) throw new Error(`${user.email} giriş yapamadı: ${r.error.kind}`);
  return app;
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
