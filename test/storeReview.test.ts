/**
 * 0.13 Bölüm 6: uygulama içi değerlendirme isteği.
 * - Gösterim koşulu: en az 3 tamamlanmış antrenman
 * - Sıklık sınırı: en fazla 90 günde bir
 * - An: rekor sayfası kapanırken ya da iyi geçen antrenmanın özetinden çıkarken
 * - Kendi "Bizi değerlendir" sorumuz yok; Hakkında'da mağaza bağlantısı
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  APP_STORE_ID,
  REVIEW_INTERVAL_DAYS,
  REVIEW_MIN_WORKOUTS,
  countCompletedWorkouts,
  isGoodWorkout,
  parseLastRequested,
  shouldRequestReview,
  storePageUrls,
} from '@/lib/storeReview';

import { createCompletedSession, createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-25T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

describe('gösterim koşulu ve sıklık sınırı', () => {
  it('3 antrenmandan önce istenmez', () => {
    expect(REVIEW_MIN_WORKOUTS).toBe(3);
    for (const n of [0, 1, 2]) {
      expect(shouldRequestReview({ completedWorkouts: n, lastRequestedAt: null, now: NOW }), String(n)).toBe(false);
    }
    expect(shouldRequestReview({ completedWorkouts: 3, lastRequestedAt: null, now: NOW })).toBe(true);
    expect(shouldRequestReview({ completedWorkouts: 40, lastRequestedAt: null, now: NOW })).toBe(true);
  });

  it('en fazla 90 günde bir', () => {
    expect(REVIEW_INTERVAL_DAYS).toBe(90);
    const at = (last: string) => shouldRequestReview({ completedWorkouts: 10, lastRequestedAt: last, now: NOW });
    expect(at(daysAgo(0))).toBe(false);
    expect(at(daysAgo(89))).toBe(false);
    expect(at(new Date(NOW - 90 * DAY + 1000).toISOString())).toBe(false);
    expect(at(daysAgo(90))).toBe(true);
    expect(at(daysAgo(400))).toBe(true);
  });

  it('saat geri alındıysa ya da kayıt bozuksa istenmez', () => {
    expect(shouldRequestReview({ completedWorkouts: 10, lastRequestedAt: daysAgo(-5), now: NOW })).toBe(false);
    expect(shouldRequestReview({ completedWorkouts: 10, lastRequestedAt: 'bozuk', now: NOW })).toBe(false);
    expect(parseLastRequested(null)).toBeNull();
    expect(parseLastRequested('  ')).toBeNull();
    expect(parseLastRequested(daysAgo(1))).toBe(daysAgo(1));
  });

  it('iyi geçen antrenman: planlanan bütün setler tamamlandı', () => {
    expect(isGoodWorkout({ completedSets: 12, plannedSets: 12 })).toBe(true);
    expect(isGoodWorkout({ completedSets: 11, plannedSets: 12 })).toBe(false);
    expect(isGoodWorkout({ completedSets: 0, plannedSets: 0 })).toBe(false);
  });
});

describe('tamamlanmış antrenman sayısı', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it('yalnızca bitmiş seanslar sayılır (yarım antrenman hariç)', async () => {
    const ex = await seedExercise(t.db);
    expect(await countCompletedWorkouts(t.db)).toBe(0);
    await createCompletedSession(t.db, { exerciseId: ex, startedAt: daysAgo(3) });
    await createCompletedSession(t.db, { exerciseId: ex, startedAt: daysAgo(2) });
    await createSession(t.db, { exerciseId: ex, startedAt: daysAgo(0) });
    expect(await countCompletedWorkouts(t.db)).toBe(2);
    await createCompletedSession(t.db, { exerciseId: ex, startedAt: daysAgo(1) });
    expect(await countCompletedWorkouts(t.db)).toBe(3);
  });
});

describe('mağaza sayfası', () => {
  it('Android: Play sayfası (Dinç Test de Play sürümünü açar)', () => {
    expect(storePageUrls('android')).toEqual({
      primary: 'market://details?id=com.dincapp.antrenman',
      fallback: 'https://play.google.com/store/apps/details?id=com.dincapp.antrenman',
    });
  });

  it('iOS: App Store kimliği gelene kadar bağlantı yok', () => {
    expect(APP_STORE_ID).toBeNull();
    expect(storePageUrls('ios')).toBeNull();
    expect(storePageUrls('web')).toBeNull();
  });
});

describe('ekranlar (kaynak)', () => {
  it('özet: rekor sayfası kapanınca ve iyi geçen antrenmandan çıkarken; geri tuşu da aynı yol', () => {
    const summary = read('app/session/summary.tsx');
    expect(summary).toContain("maybeRequestReview(db, 'record-closed')");
    expect(summary).toContain("maybeRequestReview(db, 'summary-exit')");
    expect(summary).toContain('onContinue={closeRecord}');
    expect(summary).toMatch(/if \(showRecord\) closeRecord\(\);/);
    expect(summary).toMatch(/isGoodWorkout\(/);
  });

  it('kendi "Bizi değerlendir" sorumuz yok: yalnızca sistem penceresi', () => {
    const native = read('src/lib/storeReviewNative.ts');
    expect(native).toContain('mod.requestReview()');
    expect(native).not.toMatch(/Alert\./);
    expect(native).toContain("require('expo-store-review')");
    // Tarih istekten önce yazılır: pencere açılıp uygulama kapansa da 90 gün
    expect(native.indexOf('Storage.setItem(REVIEW_LAST_KEY')).toBeLessThan(native.indexOf('mod.requestReview()'));
  });

  it('aktif antrenman ekranı değişmedi', () => {
    expect(read('app/session/active.tsx')).not.toMatch(/storeReview|requestReview/);
  });

  it('Hakkında: "Uygulamayı değerlendir" mağaza sayfasını açar', () => {
    const settings = read('src/components/settings/SettingsSections.tsx');
    const about = settings.slice(settings.indexOf('export function AboutSection'));
    expect(about).toContain('Uygulamayı değerlendir');
    expect(about).toContain('onPress={openStorePage}');
    expect(about).toContain('storePageAvailable &&');
  });
});
