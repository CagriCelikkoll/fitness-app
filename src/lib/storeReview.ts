/**
 * Uygulama içi değerlendirme isteği (0.13 Bölüm 6) — saf karar.
 *
 * Sistemin kendi penceresi (expo-store-review, `storeReviewNative.ts`);
 * kendi "Bizi değerlendir" sorumuz yok (mağaza kuralları). Pencerenin
 * gerçekten görünüp görünmediğini sistem söylemiyor; istendiği an
 * gösterilmiş sayılır ve tarih saklanır.
 *
 * Ne zaman:
 * - en az 3 tamamlanmış antrenman (bitmiş seans, bu antrenman dahil) ve
 * - son istekten bu yana en az 90 gün (hiç istenmediyse hemen) ve
 * - an uygunsa: rekor sayfası kapanırken ya da iyi geçen bir antrenmanın
 *   özetinden çıkarken (planlanan bütün setler tamamlandı).
 */

import { count, isNotNull } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { workoutSessions } from '@/db/schema';

export const REVIEW_MIN_WORKOUTS = 3;
export const REVIEW_INTERVAL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** kv-store anahtarı: son isteğin zamanı (ISO) */
export const REVIEW_LAST_KEY = 'storeReview.lastRequestedAt';

export type ReviewMoment = 'record-closed' | 'summary-exit';

/** Özetten çıkış "iyi geçti" mi: planlanan bütün setler tamamlandı */
export function isGoodWorkout(input: { completedSets: number; plannedSets: number }): boolean {
  return input.plannedSets > 0 && input.completedSets >= input.plannedSets;
}

export function shouldRequestReview(input: {
  completedWorkouts: number;
  lastRequestedAt: string | null;
  now: number;
}): boolean {
  if (input.completedWorkouts < REVIEW_MIN_WORKOUTS) return false;
  if (input.lastRequestedAt == null) return true;
  const last = Date.parse(input.lastRequestedAt);
  // Bozuk kayıt: yeniden sormaktansa sorma; tarih yine yazılınca düzelir
  if (!Number.isFinite(last)) return false;
  // Saat geri alındıysa (gelecekteki tarih) yine bekle
  return input.now - last >= REVIEW_INTERVAL_DAYS * DAY_MS;
}

/** Tamamlanmış antrenman sayısı (`endedAt IS NOT NULL`) */
export async function countCompletedWorkouts(db: Db): Promise<number> {
  const rows = await db.select({ n: count() }).from(workoutSessions).where(isNotNull(workoutSessions.endedAt));
  return rows[0]?.n ?? 0;
}

/** Saklanan tarih okunur: yoksa ya da boşsa null */
export function parseLastRequested(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

/**
 * Hakkında'daki "Uygulamayı değerlendir": mağaza sayfası. Dinç Test de Play
 * sürümünün sayfasını açar (test uygulaması mağazada yok). iOS'ta App Store
 * kimliği henüz yok (uygulama kaydı açılınca `APP_STORE_ID`); o zamana kadar
 * satır gösterilmez.
 */
export const PLAY_PACKAGE = 'com.dincapp.antrenman';
export const APP_STORE_ID: string | null = null;

export function storePageUrls(platform: string): { primary: string; fallback: string } | null {
  if (platform === 'android') {
    return {
      primary: `market://details?id=${PLAY_PACKAGE}`,
      fallback: `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`,
    };
  }
  if (platform === 'ios' && APP_STORE_ID) {
    return {
      primary: `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`,
      fallback: `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`,
    };
  }
  return null;
}
