/**
 * Seed testi.
 *
 * Kütüphane artık ağdan değil, uygulama paketine gömülü JSON'lardan
 * geliyor. Buradaki testler hem verinin gerçekten gömülü olduğunu hem de
 * seed'in iki kez çalıştırıldığında kaydı ikilemediğini doğruluyor.
 *
 * Beklenen sayılar JSON dosyalarından türetiliyor: kütüphane
 * güncellendiğinde test kendiliğinden uyum sağlasın, ama dosya boş ya da
 * bozuk gelirse alttaki alt sınır kontrolleri patlasın.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { seedIfEmpty } from '@/db/seed';
import { appSettings, exercises } from '@/db/schema';
import { countRows, createTestDb, type TestDb } from './helpers/testDb';

const freeExerciseDb = require('../assets/seed/exercises.json') as {
  id: string;
  category: string;
}[];
const cardioModes = require('../assets/seed/cardio-modes.json') as {
  id: string;
  category: string;
}[];

const EXPECTED_TOTAL = freeExerciseDb.length + cardioModes.length;

let testDb: TestDb;
let db: Db;

beforeEach(() => {
  testDb = createTestDb();
  db = testDb.db;
});

afterEach(() => {
  testDb.close();
});

describe('gömülü veri', () => {
  it('kuvvet kütüphanesi bundle içinde ve makul büyüklükte', () => {
    // Ağ yok; dosya gelmezse burada patlasın
    expect(freeExerciseDb.length).toBeGreaterThan(800);
    expect(cardioModes.length).toBe(9);
  });

  it('id çakışması yok', () => {
    const ids = new Set(freeExerciseDb.map((e) => e.id));
    for (const c of cardioModes) {
      expect(ids.has(c.id), `çakışan id: ${c.id}`).toBe(false);
    }
    expect(ids.size).toBe(freeExerciseDb.length);
  });
});

describe('seedIfEmpty', () => {
  it('boş veritabanını kuvvet + cardio kayıtlarıyla dolduruyor', async () => {
    const result = await seedIfEmpty(db);

    expect(result.seeded).toBe(true);
    expect(result.exerciseCount).toBe(EXPECTED_TOTAL);
    expect(await countRows(db, exercises)).toBe(EXPECTED_TOTAL);
  });

  it('kategori dağılımı mantıklı', async () => {
    await seedIfEmpty(db);

    const rows = await db
      .select({ category: exercises.category, n: sql<number>`count(*)` })
      .from(exercises)
      .groupBy(exercises.category);

    const counts = Object.fromEntries(
      rows.map((r) => [r.category, Number(r.n)])
    );

    // Kuvvet en kalabalık kategori olmalı
    expect(counts.strength).toBeGreaterThan(400);
    // Cardio = kütüphaneden gelenler + kendi 9 modumuz
    const cardioFromLibrary = freeExerciseDb.filter(
      (e) => e.category === 'cardio'
    ).length;
    expect(counts.cardio).toBe(cardioFromLibrary + cardioModes.length);
    // Toplam, kategorilerin toplamına eşit (kayıp kayıt yok)
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(EXPECTED_TOTAL);
  });

  it('cardio modları Türkçe adla, kütüphane kayıtları nameTr olmadan geliyor', async () => {
    await seedIfEmpty(db);

    const running = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, 'cardio_running_outdoor'));
    expect(running[0]?.nameTr).toBe('Koşu (Açık Hava)');
    expect(JSON.parse(running[0]!.primaryMuscles)).toContain('quadriceps');

    const fromLibrary = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, freeExerciseDb[0]!.id));
    expect(fromLibrary[0]?.nameTr).toBeNull();
    expect(Array.isArray(JSON.parse(fromLibrary[0]!.imagePaths ?? '[]'))).toBe(
      true
    );
  });

  it('varsayılan app_settings satırını oluşturuyor', async () => {
    await seedIfEmpty(db);

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.defaultRestSeconds).toBe(90);
  });

  it('ikinci çağrıda tekrar yazmıyor', async () => {
    await seedIfEmpty(db);

    const second = await seedIfEmpty(db);

    expect(second.seeded).toBe(false);
    expect(second.exerciseCount).toBe(EXPECTED_TOTAL);
    expect(await countRows(db, exercises)).toBe(EXPECTED_TOTAL);
  });

  it('kullanıcının eklediği egzersiz varsa seed hiç çalışmıyor', async () => {
    await db.insert(exercises).values({
      id: 'ozel-1',
      name: 'Kendi Egzersizim',
      primaryMuscles: '["chest"]',
      category: 'strength',
      isCustom: true,
    });

    const result = await seedIfEmpty(db);

    expect(result.seeded).toBe(false);
    expect(await countRows(db, exercises)).toBe(1);
  });

  it('ağ çağrısı yapmıyor (fetch çağrılmıyor)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('seed ağa çıkmamalı');
    }) as typeof fetch;

    try {
      const result = await seedIfEmpty(db);
      expect(result.exerciseCount).toBe(EXPECTED_TOTAL);
    } finally {
      globalThis.fetch = original;
    }
  });
});
