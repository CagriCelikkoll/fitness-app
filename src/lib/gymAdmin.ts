/**
 * Yönetici: üye ve salon yönetimi (v3.2d) — saf mantık + Supabase.
 * Sunucu: 0001_init.sql (üyelik kuralları) ve 0008_gym_admin.sql (salon
 * adı / rengi, katılım kodu). Yetkiyi sunucu belirler; buradaki rol
 * kontrolleri yalnızca görünüm için.
 *
 * - Üye listesi: hoca ve yönetici okur, yalnızca yönetici değiştirir.
 * - Üyelik bitişi gün hesabı salonun takvimiyle (Europe/Istanbul, UTC+3);
 *   bitiş günü dahil (o gün hâlâ üye).
 *
 * Fonksiyonlar fırlatmaz; React ve Expo bilmez; test/gymAdmin.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult, GymMembership } from '@/lib/account';
import { accountError, isGymRole, toAccountError, type GymRole } from '@/lib/auth';
import { gymNow } from '@/lib/classes';

export const GYM_NAME_MIN = 2;
export const GYM_NAME_MAX = 40;
/** "7 gün içinde bitenler" ve ana sayfa uyarısı */
export const EXPIRING_DAYS = 7;

export interface GymMember {
  userId: string;
  /** Yalnızca hoca / yöneticiye görünür; yoksa null */
  name: string | null;
  role: GymRole;
  joinedAt: string | null;
  /** YYYY-MM-DD ya da null */
  membershipEndsOn: string | null;
}

// ============================================================================
// Üyelik bitişi (salon takvimi)
// ============================================================================

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** Ay adının bulunma eki: "12 Ekim'de", "3 Mart'ta" */
const MONTH_LOCATIVE = ["'ta", "'ta", "'ta", "'da", "'ta", "'da", "'da", "'ta", "'de", "'de", "'da", "'ta"];

function keyToDay(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/**
 * Bitişe kalan gün (salon takvimiyle): 0 = bugün son gün, negatif =
 * bitti. Bitiş yoksa null.
 */
export function membershipDaysLeft(endsOn: string | null, nowMs: number): number | null {
  if (endsOn == null || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return null;
  return keyToDay(endsOn) - keyToDay(gymNow(nowMs).date);
}

/** "12 Ekim" (yıl bu yıl değilse "12 Ekim 2025") */
export function formatEndDate(endsOn: string, nowMs: number): string {
  const [y, m, d] = endsOn.split('-').map(Number);
  const thisYear = Number(gymNow(nowMs).date.slice(0, 4));
  return `${d} ${MONTHS[m - 1]}${y === thisYear ? '' : ` ${y}`}`;
}

/**
 * Ana sayfa uyarısı: 7 gün ya da daha yakınsa / bittiyse. Bitiş yoksa
 * ya da uzaksa null.
 */
export function membershipWarning(endsOn: string | null, nowMs: number): { text: string; ended: boolean } | null {
  const days = membershipDaysLeft(endsOn, nowMs);
  if (days == null || endsOn == null || days > EXPIRING_DAYS) return null;
  if (days < 0) {
    const [y, m] = endsOn.split('-').map(Number);
    const thisYear = Number(gymNow(nowMs).date.slice(0, 4));
    // Yıl eklenince ek yılın okunuşuna göre değişir; yıl sonda ise ek yok
    const date = formatEndDate(endsOn, nowMs);
    return {
      ended: true,
      text: y === thisYear ? `Üyeliğin ${date}${MONTH_LOCATIVE[m - 1]} bitti.` : `Üyeliğin bitti (${date}).`,
    };
  }
  if (days === 0) return { ended: false, text: 'Üyeliğin bugün bitiyor.' };
  if (days === 1) return { ended: false, text: 'Üyeliğin yarın bitiyor.' };
  return { ended: false, text: `Üyeliğin ${days} gün sonra bitiyor.` };
}

// ============================================================================
// Liste: filtre, arama, sayılar
// ============================================================================

export type MemberFilter = 'all' | 'trainers' | 'admins' | 'expiring' | 'expired';

export const MEMBER_FILTERS: { key: MemberFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'trainers', label: 'Hocalar' },
  { key: 'admins', label: 'Yöneticiler' },
  { key: 'expiring', label: '7 gün içinde bitenler' },
  { key: 'expired', label: 'Bitmişler' },
];

export function matchesFilter(m: GymMember, filter: MemberFilter, nowMs: number): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'trainers':
      return m.role === 'trainer';
    case 'admins':
      return m.role === 'admin';
    case 'expiring': {
      const days = membershipDaysLeft(m.membershipEndsOn, nowMs);
      return days != null && days >= 0 && days <= EXPIRING_DAYS;
    }
    case 'expired': {
      const days = membershipDaysLeft(m.membershipEndsOn, nowMs);
      return days != null && days < 0;
    }
  }
}

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFC').trim();

/** Ada göre (Türkçe büyük / küçük harf: "İ" ↔ "i", "I" ↔ "ı") */
export function matchesSearch(m: GymMember, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  return m.name != null && fold(m.name).includes(q);
}

const ROLE_ORDER: Record<GymRole, number> = { admin: 0, trainer: 1, member: 2 };

/** Yönetici, hoca, üye; her grupta ada göre (adsızlar sonda) */
export function sortMembers(list: readonly GymMember[]): GymMember[] {
  return [...list].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      (a.name == null ? 1 : 0) - (b.name == null ? 1 : 0) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'tr') ||
      a.userId.localeCompare(b.userId)
  );
}

export function filterMembers(
  list: readonly GymMember[],
  filter: MemberFilter,
  query: string,
  nowMs: number
): GymMember[] {
  return sortMembers(list.filter((m) => matchesFilter(m, filter, nowMs) && matchesSearch(m, query)));
}

/** "42 üye · 4 hoca · 1 yönetici" (sıfır olanlar yazılmaz; hepsi sıfırsa "Üye yok") */
export function memberCountsText(list: readonly GymMember[]): string {
  const count = (r: GymRole) => list.filter((m) => m.role === r).length;
  const parts = [
    [count('member'), 'üye'],
    [count('trainer'), 'hoca'],
    [count('admin'), 'yönetici'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}`);
  return parts.length > 0 ? parts.join(' · ') : 'Üye yok';
}

// ============================================================================
// Görünüm yetkileri
// ============================================================================

type Membership = Pick<GymMembership, 'gymId' | 'role'>;
const roleIn = (memberships: readonly Membership[], gymId: string) =>
  memberships.find((m) => m.gymId === gymId)?.role ?? null;

/** "Üyeler" (hoca ve yönetici) */
export function canViewMembers(gymId: string, memberships: readonly Membership[]): boolean {
  const role = roleIn(memberships, gymId);
  return role === 'admin' || role === 'trainer';
}

/** Rol, bitiş, çıkarma ve salon ayarları (yalnızca yönetici) */
export function canManageGym(gymId: string, memberships: readonly Membership[]): boolean {
  return roleIn(memberships, gymId) === 'admin';
}

/** Yönetici kendi rolünü düşüremez, kendini çıkaramaz (ayrılma Ayarlar'da) */
export function canEditMember(target: Pick<GymMember, 'userId'>, myUserId: string | null): boolean {
  return myUserId != null && target.userId !== myUserId;
}

// ============================================================================
// Salon ayarları
// ============================================================================

/**
 * Salonun seçebileceği renkler (kayıtlı değer hex). Temaya göre tonları
 * `gymAccentTones` (`src/theme.ts`) hesaplıyor; v3.5 Fuşya (Euphoria).
 */
export const GYM_COLORS: { hex: string; label: string }[] = [
  { hex: '#D7FF3E', label: 'Limon' },
  { hex: '#3EE6B0', label: 'Nane' },
  { hex: '#3EC5FF', label: 'Gök' },
  { hex: '#7C8CFF', label: 'Lavanta' },
  { hex: '#C77DFF', label: 'Mor' },
  { hex: '#FF6FAE', label: 'Pembe' },
  { hex: '#FF9A3C', label: 'Turuncu' },
  { hex: '#FFD23E', label: 'Güneş' },
  { hex: '#A33A8C', label: 'Fuşya' },
];

export function isGymColor(hex: string | null | undefined): hex is string {
  return hex != null && GYM_COLORS.some((c) => c.hex === hex);
}

export function normalizeGymName(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function gymNameError(text: string): string | null {
  const n = [...normalizeGymName(text)].length;
  if (n < GYM_NAME_MIN) return `Salon adı en az ${GYM_NAME_MIN} karakter olmalı.`;
  if (n > GYM_NAME_MAX) return `Salon adı en fazla ${GYM_NAME_MAX} karakter olabilir.`;
  return null;
}

/**
 * Yönelme eki: "Test Salonu'na", "Spor Merkezi'ne", "FitLife'a",
 * "Arena'ya". Birden çok kelimeli ve son kelimesi ı/i/u/ü ile biten ad
 * iyelik eki almış sayılır (Salonu → Salonu'na).
 */
export function withDative(name: string): string {
  const n = name.trim();
  const lower = n.toLocaleLowerCase('tr');
  const vowels = lower.match(/[aeıioöuü]/g) ?? [];
  const back = 'aıou'.includes(vowels[vowels.length - 1] ?? 'e');
  const a = back ? 'a' : 'e';
  const last = lower[lower.length - 1] ?? '';
  if (!'aeıioöuü'.includes(last)) return `${n}'${a}`;
  const possessive = /\s/.test(n) && 'ıiuü'.includes(last);
  return `${n}'${possessive ? 'n' : 'y'}${a}`;
}

export function joinCodeShareText(gymName: string, code: string): string {
  return `Dinç uygulamasında ${withDative(gymName)} katılmak için kod: ${code}`;
}

// ============================================================================
// Supabase
// ============================================================================

const ok = <T>(value: T): AccountResult<T> => ({ ok: true, value });
const err = <T>(e: unknown): AccountResult<T> => ({ ok: false, error: toAccountError(e) });
const forbidden = <T>(): AccountResult<T> => ({ ok: false, error: accountError('forbidden') });

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return { ok: false, error: accountError('not_configured') };
  try {
    return await fn(client);
  } catch (e) {
    console.error('[GYM-ADMIN] HATA:', e);
    return err(e);
  }
}

export function parseMemberRows(rows: unknown, names: Record<string, string | null>): GymMember[] {
  if (!Array.isArray(rows)) return [];
  const out: GymMember[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.user_id !== 'string' || !isGymRole(r.role)) continue;
    out.push({
      userId: r.user_id,
      name: names[r.user_id]?.trim() ? names[r.user_id] : null,
      role: r.role,
      joinedAt: typeof r.joined_at === 'string' ? r.joined_at : null,
      membershipEndsOn: typeof r.membership_ends_on === 'string' ? r.membership_ends_on : null,
    });
  }
  return out;
}

/** Salonun üyeleri ve adları (RLS: yalnızca hoca / yönetici bütün listeyi görür) */
export function fetchGymMembers(client: SupabaseClient | null, gymId: string) {
  return run<GymMember[]>(client, async (c) => {
    const { data, error } = await c
      .from('gym_members')
      .select('user_id, role, joined_at, membership_ends_on')
      .eq('gym_id', gymId)
      .limit(2000);
    if (error) return err(error);
    const ids = (data ?? []).map((r) => (r as { user_id: string }).user_id);
    const names: Record<string, string | null> = {};
    // Adlar parça parça (URL uzunluğu)
    for (let i = 0; i < ids.length; i += 200) {
      const profiles = await c.from('profiles').select('id, display_name').in('id', ids.slice(i, i + 200));
      if (profiles.error) return err(profiles.error);
      for (const p of (profiles.data ?? []) as { id: string; display_name: string | null }[]) {
        names[p.id] = p.display_name;
      }
    }
    return ok(parseMemberRows(data, names));
  });
}

/** Rol ve / veya bitiş tarihi. RLS izin vermezse satır dönmez → "yetkin yok" */
export function updateMember(
  client: SupabaseClient | null,
  gymId: string,
  userId: string,
  patch: { role?: GymRole; membershipEndsOn?: string | null }
) {
  return run<GymMember>(client, async (c) => {
    const values = {
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.membershipEndsOn !== undefined ? { membership_ends_on: patch.membershipEndsOn } : {}),
    };
    const { data, error } = await c
      .from('gym_members')
      .update(values)
      .eq('gym_id', gymId)
      .eq('user_id', userId)
      .select('user_id, role, joined_at, membership_ends_on');
    if (error) return err(error);
    const [row] = parseMemberRows(data, {});
    return row ? ok(row) : forbidden();
  });
}

/** Salondan çıkarma (yalnızca yönetici, başkasını) */
export function removeMember(client: SupabaseClient | null, gymId: string, userId: string) {
  return run<null>(client, async (c) => {
    const { data, error } = await c
      .from('gym_members')
      .delete()
      .eq('gym_id', gymId)
      .eq('user_id', userId)
      .select('user_id');
    if (error) return err(error);
    return Array.isArray(data) && data.length > 0 ? ok(null) : forbidden();
  });
}

export interface GymSettings {
  name: string;
  primaryColor: string | null;
  /** Logo (v3.3); yükleme / kaldırma gymLogo.ts'te */
  logoUrl: string | null;
}

type GymSettingsRow = { name: string; primary_color: string | null; logo_url: string | null };
const GYM_SETTINGS_COLUMNS = 'name, primary_color, logo_url';
const toSettings = (r: GymSettingsRow): GymSettings => ({
  name: r.name,
  primaryColor: r.primary_color,
  logoUrl: r.logo_url,
});

export function fetchGymSettings(client: SupabaseClient | null, gymId: string) {
  return run<GymSettings>(client, async (c) => {
    const { data, error } = await c.from('gyms').select(GYM_SETTINGS_COLUMNS).eq('id', gymId).maybeSingle();
    if (error) return err(error);
    if (!data) return forbidden();
    return ok(toSettings(data as GymSettingsRow));
  });
}

export function updateGymSettings(
  client: SupabaseClient | null,
  gymId: string,
  patch: Partial<Pick<GymSettings, 'name' | 'primaryColor'>>
) {
  return run<GymSettings>(client, async (c) => {
    const values = {
      ...(patch.name !== undefined ? { name: normalizeGymName(patch.name) } : {}),
      ...(patch.primaryColor !== undefined ? { primary_color: patch.primaryColor } : {}),
    };
    const { data, error } = await c.from('gyms').update(values).eq('id', gymId).select(GYM_SETTINGS_COLUMNS);
    if (error) return err(error);
    const row = (data ?? [])[0] as GymSettingsRow | undefined;
    return row ? ok(toSettings(row)) : forbidden();
  });
}

export function fetchJoinCode(client: SupabaseClient | null, gymId: string) {
  return run<string>(client, async (c) => {
    const { data, error } = await c.rpc('gym_join_code', { p_gym_id: gymId });
    if (error) return err(error);
    return typeof data === 'string' ? ok(data) : forbidden();
  });
}

export function regenerateJoinCode(client: SupabaseClient | null, gymId: string) {
  return run<string>(client, async (c) => {
    const { data, error } = await c.rpc('regenerate_join_code', { p_gym_id: gymId });
    if (error) return err(error);
    return typeof data === 'string' ? ok(data) : forbidden();
  });
}
