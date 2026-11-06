/**
 * Aydınlatma metni onayı (v3.7, KVKK) — saf mantık + Supabase çağrıları.
 *
 * - Giriş ekranında "Kodu gönder"den önce "Aydınlatma Metni'ni okudum"
 *   işaretlenir. Bu bir açık rıza değil, bilgilendirildiğinin kaydı; metin
 *   "kabul ediyorum / rıza veriyorum" demez.
 * - Kod doğrulanınca sürüm sunucuya yazılır (`ack_privacy_notice`,
 *   supabase/migrations/0014_auth_hardening.sql): `profiles.privacy_version`
 *   ve `privacy_ack_at` (sunucu saati). İnternet yoksa / sunucu reddederse
 *   cihazda bekler (kv-store) ve oturum bir dahaki açılışta yeniden dener.
 * - Sürüm `PRIVACY_NOTICE_VERSION` (src/content/legal.ts). Kayıtlı sürüm
 *   daha eskiyse ya da yoksa (v3.7 öncesi hesaplar) ana sayfada yeniden
 *   sorulur.
 *
 * Fonksiyonlar fırlatmaz; React ve Expo bilmez; test/privacyNotice.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { PRIVACY_NOTICE_VERSION } from '@/content/legal';
import type { AccountResult } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';

export { PRIVACY_NOTICE_VERSION };

/** Onay kutusunun metni (giriş ekranı ve ana sayfa kartı) */
export const PRIVACY_NOTICE_CHECKBOX = "Aydınlatma Metni'ni okudum.";

const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isPrivacyVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/**
 * Yeniden sorulmalı mı: kayıt yok ya da güncel sürümden eski. Başka
 * cihazda daha yeni sürüm onaylandıysa (yeni uygulama) eski uygulama
 * tekrar sormaz.
 */
export function needsPrivacyAck(
  storedVersion: string | null | undefined,
  current: string = PRIVACY_NOTICE_VERSION
): boolean {
  if (!isPrivacyVersion(storedVersion)) return true;
  return storedVersion < current;
}

/** Ana sayfa kartının metni: hiç onay yoksa / metin güncellendiyse */
export function privacyAckCardText(storedVersion: string | null): { title: string; body: string } {
  return isPrivacyVersion(storedVersion)
    ? {
        title: 'Aydınlatma Metni güncellendi',
        body: 'Hesabınla ilgili bilgilerin nasıl işlendiğini anlatan metin değişti. Okuduktan sonra işaretle.',
      }
    : {
        title: 'Aydınlatma Metni',
        body: 'Hesabınla ilgili bilgilerin nasıl işlendiğini anlatan metni oku ve okuduğunu işaretle.',
      };
}

// ============================================================================
// Bekleyen onay (cihazda; giriş sonrası yazılamadıysa)
// ============================================================================

export const PENDING_ACK_KEY = 'privacy.pendingAck';

export interface PendingAckStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export async function readPendingAck(store: PendingAckStore): Promise<string | null> {
  try {
    const v = await store.getItem(PENDING_ACK_KEY);
    return isPrivacyVersion(v) ? v : null;
  } catch {
    return null;
  }
}

export async function savePendingAck(store: PendingAckStore, version: string): Promise<void> {
  try {
    await store.setItem(PENDING_ACK_KEY, version);
  } catch (err) {
    console.warn('[PRIVACY] Bekleyen onay kaydedilemedi:', err);
  }
}

export async function clearPendingAck(store: PendingAckStore): Promise<void> {
  try {
    await store.removeItem(PENDING_ACK_KEY);
  } catch (err) {
    console.warn('[PRIVACY] Bekleyen onay silinemedi:', err);
  }
}

// ============================================================================
// Supabase
// ============================================================================

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return { ok: false, error: accountError('not_configured') };
  try {
    return await fn(client);
  } catch (e) {
    console.error('[PRIVACY] HATA:', e);
    return { ok: false, error: toAccountError(e) };
  }
}

/** Giriş yapmış kullanıcının onayını yazar (sunucu saatiyle) */
export function ackPrivacyNotice(client: SupabaseClient | null, version: string = PRIVACY_NOTICE_VERSION) {
  return run<null>(client, async (c) => {
    const { error } = await c.rpc('ack_privacy_notice', { p_version: version });
    return error ? { ok: false, error: toAccountError(error) } : { ok: true, value: null };
  });
}

export interface PrivacyAck {
  version: string | null;
  ackAt: string | null;
}

export function parsePrivacyAckRows(data: unknown): PrivacyAck {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  return {
    version: isPrivacyVersion(row?.privacy_version) ? row.privacy_version : null,
    ackAt: typeof row?.privacy_ack_at === 'string' ? row.privacy_ack_at : null,
  };
}

/** Kendi onayın (sürüm + tarih); hiç yoksa ikisi de null */
export function fetchPrivacyAck(client: SupabaseClient | null) {
  return run<PrivacyAck>(client, async (c) => {
    const { data, error } = await c.rpc('my_privacy_ack');
    return error ? { ok: false, error: toAccountError(error) } : { ok: true, value: parsePrivacyAckRows(data) };
  });
}
