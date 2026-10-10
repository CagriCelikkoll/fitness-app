/**
 * Hesap ve salon (v3.0) — Supabase çağrıları.
 *
 * Her fonksiyon istemciyi parametre alıyor; istemci `null` ise (env yok)
 * ağa hiç çıkmadan `not_configured` döner. Hiçbiri fırlatmaz: hata
 * `{ ok: false, error }` olarak döner, ekran Türkçe mesajı gösterir.
 * Lokal veriye (SQLite) dokunmaz.
 *
 * Sunucu tarafı: supabase/migrations/0001_init.sql.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  accountError,
  isGymRole,
  normalizeEmail,
  normalizeJoinCode,
  toAccountError,
  type AccountError,
  type GymRole,
} from '@/lib/auth';

export type AccountResult<T> = { ok: true; value: T } | { ok: false; error: AccountError };

export interface GymMembership {
  gymId: string;
  gymName: string;
  role: GymRole;
  /** YYYY-MM-DD ya da null */
  membershipEndsOn: string | null;
  joinedAt: string | null;
}

const ok = <T>(value: T): AccountResult<T> => ({ ok: true, value });
const fail = <T>(error: AccountError): AccountResult<T> => ({ ok: false, error });

async function run<T>(
  client: SupabaseClient | null,
  fn: (client: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return fail(accountError('not_configured'));
  try {
    return await fn(client);
  } catch (err) {
    console.error('[ACCOUNT] HATA:', err);
    return fail(toAccountError(err));
  }
}

// ============================================================================
// Giriş: e-posta + 6 haneli kod
// ============================================================================

export function sendSignInCode(client: SupabaseClient | null, email: string) {
  return run(client, async (c) => {
    const { error } = await c.auth.signInWithOtp({
      email: normalizeEmail(email),
      options: { shouldCreateUser: true },
    });
    return error ? fail<null>(toAccountError(error)) : ok(null);
  });
}

export function verifySignInCode(client: SupabaseClient | null, email: string, code: string) {
  return run(client, async (c) => {
    const { error } = await c.auth.verifyOtp({
      email: normalizeEmail(email),
      token: code,
      type: 'email',
    });
    return error ? fail<null>(toAccountError(error)) : ok(null);
  });
}

/**
 * Yalnızca bu cihazdaki oturumu kapatır. Ağ hatasında da oturum yerelde
 * silinir (supabase-js böyle davranıyor); lokal antrenman verisine
 * dokunulmaz.
 */
export function signOut(client: SupabaseClient | null) {
  return run(client, async (c) => {
    const { error } = await c.auth.signOut({ scope: 'local' });
    if (error) console.error('[ACCOUNT] Çıkış (sunucu tarafı) hatası:', error);
    return ok(null);
  });
}

// ============================================================================
// Salon
// ============================================================================

/** Satırları uygulama tipine çevirir; bozuk satırları atlar */
export function parseMembershipRows(data: unknown): GymMembership[] {
  if (!Array.isArray(data)) return [];
  const result: GymMembership[] = [];
  for (const row of data) {
    if (row == null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    // Gömülü ilişki tek nesne gelir; bazı sürümlerde dizi
    const gymRaw = Array.isArray(r.gyms) ? r.gyms[0] : r.gyms;
    const gym = (gymRaw ?? {}) as Record<string, unknown>;
    if (typeof r.gym_id !== 'string' || !isGymRole(r.role) || typeof gym.name !== 'string') {
      continue;
    }
    result.push({
      gymId: r.gym_id,
      gymName: gym.name,
      role: r.role,
      membershipEndsOn: typeof r.membership_ends_on === 'string' ? r.membership_ends_on : null,
      joinedAt: typeof r.joined_at === 'string' ? r.joined_at : null,
    });
  }
  // En son katılınan önce
  return result.sort((a, b) => (b.joinedAt ?? '').localeCompare(a.joinedAt ?? ''));
}

export function fetchMemberships(client: SupabaseClient | null, userId: string) {
  return run(client, async (c) => {
    const { data, error } = await c
      .from('gym_members')
      .select('gym_id, role, membership_ends_on, joined_at, gyms(name)')
      .eq('user_id', userId);
    return error ? fail<GymMembership[]>(toAccountError(error)) : ok(parseMembershipRows(data));
  });
}

/** Katılmadan önce salon adı. Geçersiz kodda sunucu boş döner → invalid_code */
export function previewGym(client: SupabaseClient | null, code: string) {
  return run(client, async (c) => {
    const { data, error } = await c.rpc('preview_gym', { code: normalizeJoinCode(code) });
    if (error) return fail<string>(toAccountError(error));
    const name = Array.isArray(data) ? (data[0] as { gym_name?: unknown })?.gym_name : undefined;
    return typeof name === 'string' ? ok(name) : fail<string>(accountError('invalid_code'));
  });
}

export function joinGym(client: SupabaseClient | null, code: string) {
  return run(client, async (c) => {
    const { data, error } = await c.rpc('join_gym', { code: normalizeJoinCode(code) });
    if (error) return fail<GymMembership>(toAccountError(error));
    const row = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null;
    if (!row || typeof row.gym_id !== 'string' || !isGymRole(row.role)) {
      return fail<GymMembership>(accountError('invalid_code'));
    }
    return ok<GymMembership>({
      gymId: row.gym_id,
      gymName: typeof row.gym_name === 'string' ? row.gym_name : '',
      role: row.role,
      membershipEndsOn: null,
      joinedAt: null,
    });
  });
}

/**
 * Salondan ayrılma. RLS izin vermezse (salonun tek yöneticisi) satır
 * silinmez ve hata da gelmez; silinen satır sayısına bakılıyor. Üye
 * satırı zaten yoksa (başka cihazdan ayrılmış) ayrılmış sayılır.
 */
export function leaveGym(
  client: SupabaseClient | null,
  membership: Pick<GymMembership, 'gymId' | 'role'>,
  userId: string
) {
  return run(client, async (c) => {
    const { data, error } = await c
      .from('gym_members')
      .delete()
      .eq('gym_id', membership.gymId)
      .eq('user_id', userId)
      .select('gym_id');
    if (error) return fail<null>(toAccountError(error));
    const deleted = Array.isArray(data) && data.length > 0;
    return deleted || membership.role !== 'admin' ? ok(null) : fail<null>(accountError('last_admin'));
  });
}
