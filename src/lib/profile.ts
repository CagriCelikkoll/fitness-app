/**
 * Ad alanı (profiles.display_name) — saf mantık + Supabase çağrıları.
 * Sunucu: supabase/migrations/0007_display_name.sql (2–40 karakter
 * kısıtı, kayıtta verilen adın profile yazılması).
 *
 * - Ad isteğe bağlı; salona katılırken zorunlu (ekran denetler).
 * - Görünürlük sunucuda: yalnızca kendisi ve salonunun hoca / yöneticisi.
 *   Duyuru yazarı adı, duyuruyu görebilen üyelere.
 * - "Adını ekle" sorusu uygulamada kullanıcı başına bir kez (kv-store).
 *
 * Fonksiyonlar fırlatmaz; React ve Expo bilmez; test/profile.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';
import type { KeyValueStore } from '@/lib/announcements';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

/** Baş / son boşluk yok, iç boşluklar tek, kontrol karakteri yok (sunucu da öyle) */
export function normalizeDisplayName(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Kod noktası sayısı (emoji 1; sunucunun char_length'i gibi) */
export function displayNameLength(text: string): number {
  return [...normalizeDisplayName(text)].length;
}

/**
 * Doğrulama; geçerliyse null. `required` değilse boş ad geçerli
 * (adı silmek / kayıtta boş bırakmak).
 */
export function displayNameError(text: string, { required = false } = {}): string | null {
  const n = displayNameLength(text);
  if (n === 0) return required ? 'Adını yaz.' : null;
  if (n < DISPLAY_NAME_MIN) return `Ad en az ${DISPLAY_NAME_MIN} karakter olmalı.`;
  if (n > DISPLAY_NAME_MAX) return `Ad en fazla ${DISPLAY_NAME_MAX} karakter olabilir.`;
  return null;
}

/** Sunucuya giden değer: boşsa null */
export function displayNameValue(text: string): string | null {
  return normalizeDisplayName(text) || null;
}

// ============================================================================
// "Adını ekle" sorusu (bir kez)
// ============================================================================

export const namePromptKey = (userId: string) => `profile.namePrompted.${userId}`;

/** Salondaysa, adı yoksa ve daha önce sorulmadıysa */
export function shouldPromptForName(input: {
  inGym: boolean;
  displayName: string | null;
  loaded: boolean;
  prompted: boolean;
}): boolean {
  return input.loaded && input.inGym && input.displayName == null && !input.prompted;
}

export async function wasNamePrompted(store: KeyValueStore, userId: string): Promise<boolean> {
  try {
    return (await store.getItem(namePromptKey(userId))) === '1';
  } catch {
    return false;
  }
}

export async function markNamePrompted(store: KeyValueStore, userId: string): Promise<void> {
  await store.setItem(namePromptKey(userId), '1');
}

// ============================================================================
// Supabase
// ============================================================================

const ok = <T>(value: T): AccountResult<T> => ({ ok: true, value });
const err = <T>(e: unknown): AccountResult<T> => ({ ok: false, error: toAccountError(e) });

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return { ok: false, error: accountError('not_configured') };
  try {
    return await fn(client);
  } catch (e) {
    console.error('[PROFILE] HATA:', e);
    return err(e);
  }
}

const nameOf = (row: unknown): string | null => {
  const v = (row as { display_name?: unknown } | null)?.display_name;
  return typeof v === 'string' && v.trim() ? v : null;
};

export function fetchMyDisplayName(client: SupabaseClient | null, userId: string) {
  return run<string | null>(client, async (c) => {
    const { data, error } = await c.from('profiles').select('display_name').eq('id', userId).maybeSingle();
    if (error) return err(error);
    return ok(nameOf(data));
  });
}

/** Kendi adını yaz / sil (boş → null). RLS başkasınınkine izin vermez. */
export function updateDisplayName(client: SupabaseClient | null, userId: string, text: string) {
  return run<string | null>(client, async (c) => {
    const { data, error } = await c
      .from('profiles')
      .update({ display_name: displayNameValue(text) })
      .eq('id', userId)
      .select('display_name');
    if (error) return err(error);
    if (!Array.isArray(data) || data.length === 0) return { ok: false, error: accountError('forbidden') };
    return ok(nameOf(data[0]));
  });
}
