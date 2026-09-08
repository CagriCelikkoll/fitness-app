/**
 * Seed işlemi — uygulamanın ilk açılışında çalışır.
 *
 * Strateji:
 * 1. exercises tablosu boş mu kontrol et
 * 2. Boşsa Free Exercise DB'nin exercises.json'ını GitHub'dan çek
 *    (ilk açılışta tek seferlik, ~150KB, kullanıcı internetli olduğunda)
 * 3. Manuel cardio modlarımızı (cardio-modes.json) ekle
 * 4. Tek toplu transaction ile insert et
 *
 * NOT: Production'da exercises.json'ı app bundle'ına gömeriz (offline ilk açılış).
 * Şu an basitlik için GitHub'dan çekiyoruz; bu yapıyı sonra
 * `require('../../assets/seed/free-exercise-db.json')` yapıp gömülü hale
 * getirmek tek satırlık değişiklik.
 */

import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { exercises, appSettings, type NewExercise } from './schema';
import { newId } from '@/lib/id';

const FREE_EXERCISE_DB_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

// Kendi seed dosyamızdan import — Metro bunu app bundle'ında saklayacak
const cardioModes = require('../../assets/seed/cardio-modes.json') as Array<{
  id: string;
  name: string;
  name_tr: string;
  primary_muscles: string[];
  secondary_muscles?: string[];
  equipment?: string;
  category: string;
  level?: string;
  instructions: string[];
}>;

interface FreeExerciseDbRow {
  id: string;
  name: string;
  force?: string | null;
  level?: string | null;
  mechanic?: string | null;
  equipment?: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

/**
 * Veritabanı boşsa seed çalıştırır, doluysa hiçbir şey yapmaz.
 * Migration'lardan SONRA çağrılmalı.
 */
export async function seedIfEmpty(db: Db): Promise<{
  seeded: boolean;
  exerciseCount: number;
}> {
  // 1. exercises ve app_settings durumunu kontrol et
  const [{ count: exerciseCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(exercises);

  if (exerciseCount > 0) {
    return { seeded: false, exerciseCount };
  }

  // 2. Free Exercise DB'yi çek
  let strengthExercises: FreeExerciseDbRow[] = [];
  try {
    const response = await fetch(FREE_EXERCISE_DB_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    strengthExercises = await response.json();
  } catch (error) {
    console.warn(
      '[seed] Free Exercise DB indirilirken hata, sadece cardio modları yüklenecek:',
      error
    );
  }

  // 3. Strength egzersizlerini şemaya çevir
  const strengthRows: NewExercise[] = strengthExercises.map((e) => ({
    id: e.id,
    name: e.name,
    nameTr: null, // ileride çevirileri ekleyeceğiz
    primaryMuscles: JSON.stringify(e.primaryMuscles),
    secondaryMuscles: JSON.stringify(e.secondaryMuscles ?? []),
    equipment: e.equipment ?? null,
    mechanic: e.mechanic ?? null,
    force: e.force ?? null,
    category: e.category,
    level: e.level ?? null,
    instructions: JSON.stringify(e.instructions),
    imagePaths: JSON.stringify(e.images),
    isCustom: false,
    isArchived: false,
  }));

  // 4. Cardio modlarını şemaya çevir
  const cardioRows: NewExercise[] = cardioModes.map((c) => ({
    id: c.id,
    name: c.name,
    nameTr: c.name_tr,
    primaryMuscles: JSON.stringify(c.primary_muscles),
    secondaryMuscles: JSON.stringify(c.secondary_muscles ?? []),
    equipment: c.equipment ?? null,
    mechanic: null,
    force: null,
    category: c.category,
    level: c.level ?? null,
    instructions: JSON.stringify(c.instructions),
    imagePaths: JSON.stringify([]), // cardio için görsel yok şimdilik
    isCustom: false,
    isArchived: false,
  }));

  // 5. Tek toplu insert (transaction). SQLite ~800 satırı bir saniyenin altında atar.
  const allRows = [...strengthRows, ...cardioRows];
  if (allRows.length > 0) {
    // SQLite'ın 999 parametrelik bind limitini aşmamak için 100'erli batch
    const BATCH_SIZE = 100;
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const batch = allRows.slice(i, i + BATCH_SIZE);
      await db.insert(exercises).values(batch);
    }
  }

  // 6. Varsayılan app_settings satırını oluştur
  await db
    .insert(appSettings)
    .values({ id: 1 })
    .onConflictDoNothing();

  return { seeded: true, exerciseCount: allRows.length };
}
