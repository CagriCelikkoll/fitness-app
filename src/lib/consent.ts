/**
 * Vücut ölçüleri için açık rıza (KVKK md. 6) — saf mantık.
 *
 * Kilo, yağ oranı ve çevre ölçüleri sağlık verisi sayılabilir; girişi,
 * grafiği ve geçmişi yalnızca rıza `granted` iken görünür. Antrenman,
 * rutin ve ilerleme (ağırlık/tekrar) rızaya bağlı değil.
 *
 * Durum kv-store'da (`consent.bodyMetrics`), şema değişmiyor. Kayıt yoksa
 * ya da okunamıyorsa `unknown`. `textVersion` rıza metni değişirse yeniden
 * sorabilmek için: kayıttaki sürüm güncel değilse durum `unknown` sayılır.
 *
 * Hook: `src/hooks/useHealthConsent.ts`. Metinler: `src/content/legal.ts`.
 */

import { count } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { bodyMetrics } from '@/db/schema';
import type { KeyValueStore } from '@/lib/onboarding';

/** kv-store anahtarı. Değiştirme: verilen rızalar kaybolur. */
export const CONSENT_KEY = 'consent.bodyMetrics';

/** Rıza metninin (METİN 3) sürümü. Metin değişirse artır: herkese yeniden sorulur. */
export const CONSENT_TEXT_VERSION = 1;

export type ConsentStatus = 'granted' | 'declined' | 'withdrawn';
export type ConsentState = ConsentStatus | 'unknown';

export interface ConsentRecord {
  status: ConsentStatus;
  /** ISO tarih */
  at: string;
  textVersion: number;
}

const STATUSES: readonly ConsentStatus[] = ['granted', 'declined', 'withdrawn'];

/** kv-store değeri → kayıt; yoksa ya da bozuksa null (çökmez) */
export function parseConsentRecord(raw: string | null): ConsentRecord | null {
  if (raw == null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value == null) return null;
    const { status, at, textVersion } = value as Record<string, unknown>;
    if (!STATUSES.includes(status as ConsentStatus)) return null;
    if (typeof at !== 'string' || typeof textVersion !== 'number') return null;
    return { status: status as ConsentStatus, at, textVersion };
  } catch {
    return null;
  }
}

/** Kayıt → durum. Eski metne verilmiş yanıt geçersiz: `unknown`. */
export function consentStateFromRaw(raw: string | null): ConsentState {
  const record = parseConsentRecord(raw);
  if (record == null || record.textVersion !== CONSENT_TEXT_VERSION) return 'unknown';
  return record.status;
}

/** Ölçü girişi, grafiği ve geçmişi açık mı */
export function canUseBodyMetrics(state: ConsentState): boolean {
  return state === 'granted';
}

/**
 * Açılışta tam ekran rıza sorusu (güncellemeyle gelen kullanıcı): rıza
 * hiç sorulmamış ve en az bir ölçü kaydı var. Kaydı olmayana sorulmaz;
 * ilk ölçü girişindeki kapı yeter.
 */
export function shouldAskExistingUser(input: {
  state: ConsentState;
  bodyMetricCount: number;
}): boolean {
  return input.state === 'unknown' && input.bodyMetricCount > 0;
}

export async function getConsentState(store: KeyValueStore): Promise<ConsentState> {
  return consentStateFromRaw(await store.getItem(CONSENT_KEY));
}

export async function saveConsent(
  store: KeyValueStore,
  status: ConsentStatus,
  now: Date = new Date()
): Promise<ConsentRecord> {
  const record: ConsentRecord = {
    status,
    at: now.toISOString(),
    textVersion: CONSENT_TEXT_VERSION,
  };
  await store.setItem(CONSENT_KEY, JSON.stringify(record));
  return record;
}

// ============================================================================
// Veritabanı
// ============================================================================

export async function countBodyMetrics(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(bodyMetrics);
  return row?.n ?? 0;
}

/**
 * "Hepsini sil": yalnızca vücut ölçüsü tablosu. Profil (boy, doğum
 * tarihi, cinsiyet), antrenmanlar ve rutinler duruyor.
 */
export async function deleteAllBodyMetrics(db: Db): Promise<void> {
  await db.delete(bodyMetrics);
}

// ============================================================================
// Yedek paylaşım uyarısı
// ============================================================================

/** kv-store anahtarı: "Bir daha gösterme" seçildi mi */
export const BACKUP_WARNING_HIDDEN_KEY = 'backupWarning.hidden';

export async function isBackupWarningHidden(store: KeyValueStore): Promise<boolean> {
  return (await store.getItem(BACKUP_WARNING_HIDDEN_KEY)) === 'true';
}

export async function hideBackupWarning(store: KeyValueStore): Promise<void> {
  await store.setItem(BACKUP_WARNING_HIDDEN_KEY, 'true');
}
