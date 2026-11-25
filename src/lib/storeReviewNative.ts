/**
 * Değerlendirme penceresi ve mağaza sayfası (0.13 Bölüm 6) — native
 * katman; karar `storeReview.ts`'te (saf). Testte kullanılmaz.
 *
 * Modül `require` ile yükleniyor: native modülü olmayan eski derlemeye OTA
 * gitse de açılışta çökmez, pencere istenmez. Hata yutulur: değerlendirme
 * hiçbir akışı bozmamalı (özetten çıkış, rekor sayfası).
 */

import { Linking, Platform } from 'react-native';
import Storage from 'expo-sqlite/kv-store';

import type { Db } from '@/db/client';
import {
  REVIEW_LAST_KEY,
  countCompletedWorkouts,
  parseLastRequested,
  shouldRequestReview,
  storePageUrls,
  type ReviewMoment,
} from '@/lib/storeReview';

type StoreReviewModule = typeof import('expo-store-review');

let cached: StoreReviewModule | null | undefined;

function load(): StoreReviewModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-store-review') as StoreReviewModule;
  } catch (err) {
    console.warn('[REVIEW] Modül yüklenemedi:', err);
    cached = null;
  }
  return cached;
}

let running = false;

/** Koşullar uygunsa sistemin değerlendirme penceresini ister */
export async function maybeRequestReview(db: Db, moment: ReviewMoment): Promise<void> {
  if (running) return;
  running = true;
  try {
    const [completedWorkouts, raw] = await Promise.all([countCompletedWorkouts(db), Storage.getItem(REVIEW_LAST_KEY)]);
    if (!shouldRequestReview({ completedWorkouts, lastRequestedAt: parseLastRequested(raw), now: Date.now() })) return;
    const mod = load();
    if (!mod || !(await mod.isAvailableAsync())) return;
    // Önce tarih: pencere açılıp uygulama kapansa da 90 gün beklensin
    await Storage.setItem(REVIEW_LAST_KEY, new Date().toISOString());
    await mod.requestReview();
  } catch (err) {
    console.warn(`[REVIEW] İstenemedi (${moment}):`, err);
  } finally {
    running = false;
  }
}

/** Hakkında'daki satır gösterilsin mi (iOS'ta App Store kimliği gelene kadar hayır) */
export const storePageAvailable = storePageUrls(Platform.OS) != null;

/** Mağaza sayfası; mağaza uygulaması yoksa tarayıcıda */
export function openStorePage(): void {
  const urls = storePageUrls(Platform.OS);
  if (!urls) return;
  Linking.openURL(urls.primary).catch(() =>
    Linking.openURL(urls.fallback).catch((err) => console.warn('[REVIEW] Mağaza açılamadı:', err))
  );
}
