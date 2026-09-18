/**
 * Seed işlemi — uygulamanın ilk açılışında çalışır.
 *
 * Strateji:
 * 1. exercises tablosu boş mu kontrol et
 * 2. Boşsa iki gömülü JSON'u oku: Free Exercise DB anlık görüntüsü
 *    (assets/seed/exercises.json) + kendi cardio modlarımız
 *    (assets/seed/cardio-modes.json)
 * 3. Hepsini tek transaction içinde insert et
 *
 * **Ağ erişimi yok.** Kütüphane eskiden ilk açılışta GitHub'dan
 * indiriliyordu; internet yoksa tablo 9 cardio kaydıyla "dolu" sayılıyor,
 * seed bir daha çalışmıyor ve kuvvet egzersizleri kalıcı olarak
 * eksik kalıyordu. Bağımsız APK'da bu kabul edilemezdi, bu yüzden veri
 * uygulama paketine gömüldü.
 *
 * Kısmi durum yok: insert'ler tek transaction içinde, hata olursa
 * tablo boş kalır ve seed bir sonraki açılışta yeniden denenir.
 *
 * NOT: Egzersiz *görselleri* hâlâ GitHub'dan çekiliyor
 * (src/lib/exerciseImage.ts). Görsel gelmemesi uygulamayı kullanılmaz
 * yapmadığı için bilinçli olarak öyle bırakıldı.
 */

import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { exercises, appSettings, type NewExercise } from './schema';

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

interface CardioModeRow {
  id: string;
  name: string;
  name_tr: string;
  primary_muscles: string[];
  secondary_muscles?: string[];
  equipment?: string;
  category: string;
  level?: string;
  instructions: string[];
}

/**
 * JSON'ları `require` ile alıyoruz: Metro bunları app bundle'ına gömüyor.
 * `import` de çalışırdı ama tsc 876 kayıtlık dosyanın tamamı için literal
 * tip çıkarmaya kalkıyor ve type-check'i gereksiz yere yavaşlatıyor;
 * `require` + cast bu maliyeti ortadan kaldırıyor.
 */
const freeExerciseDb =
  require('../../assets/seed/exercises.json') as FreeExerciseDbRow[];
const cardioModes =
  require('../../assets/seed/cardio-modes.json') as CardioModeRow[];

/** SQLite'ın 999 parametrelik bind limitini aşmamak için */
const BATCH_SIZE = 100;

/**
 * Veritabanı boşsa seed çalıştırır, doluysa hiçbir şey yapmaz.
 * Migration'lardan SONRA çağrılmalı.
 *
 * Gömülü veri okunamazsa hata fırlatır — yarım dolu bir kütüphaneyle
 * devam etmektense açılışta görünür şekilde başarısız olmak daha iyi.
 */
export async function seedIfEmpty(db: Db): Promise<{
  seeded: boolean;
  exerciseCount: number;
}> {
  const [{ count: exerciseCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(exercises);

  if (exerciseCount > 0) {
    return { seeded: false, exerciseCount };
  }

  const strengthRows: NewExercise[] = freeExerciseDb.map((e) => ({
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

  const allRows = [...strengthRows, ...cardioRows];

  // Gömülü dosyalar bundle'a girmemişse (yanlış yapılandırılmış build)
  // sessizce boş kütüphaneyle devam etme.
  if (strengthRows.length === 0 || cardioRows.length === 0) {
    throw new Error(
      `Gömülü egzersiz verisi okunamadı (kuvvet: ${strengthRows.length}, cardio: ${cardioRows.length}).`
    );
  }

  // Tek transaction: yarıda kalırsa tablo boş kalsın, seed bir sonraki
  // açılışta baştan denesin.
  await db.transaction(async (tx) => {
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      await tx.insert(exercises).values(allRows.slice(i, i + BATCH_SIZE));
    }

    // Varsayılan app_settings satırı
    await tx.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  });

  return { seeded: true, exerciseCount: allRows.length };
}
