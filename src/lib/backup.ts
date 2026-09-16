/**
 * Veri yedekleme / geri yükleme.
 *
 * Uygulama lokal-first: tüm veri cihazdaki SQLite'ta yaşıyor. Telefon
 * değişimi veya uygulamanın silinmesi = her şeyin kaybı. Bu dosya o
 * riski kapatan tek çıkış yolu.
 *
 * Tasarım kararları:
 * - Yedek dosyası **kendi kendine yeterli**: egzersiz kütüphanesi dahil
 *   dokuz tablo da içinde. Dosya büyür (~1-2 MB) ama geri yükleme Free
 *   Exercise DB'nin o anki haline bağımlı olmaz.
 * - Geri yükleme **tam değiştirme**; birleştirme (merge) yok. Mevcut
 *   veri silinip yedektekiyle değiştirilir.
 * - `formatVersion` ileride şema değişirse eski yedekleri tanıyıp
 *   dönüştürebilmek için. Bulut senkronizasyonu gündeme gelirse bu
 *   yapı temel alınacak.
 *
 * Ekran bu modülü sadece çağırır; iş mantığı burada kalsın ki ileride
 * otomatik yedek / senkronizasyon gibi başka bağlamlarda da kullanılabilsin.
 *
 * **Bu dosyada Expo importu yok.** Dosya yazma / paylaşma ve uygulama
 * sürümünü okuma `src/lib/backupFile.ts` içinde; böylece buradaki mantık
 * Node'da (testlerde) gerçek SQLite'a karşı doğrudan çalıştırılabiliyor.
 */

import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { Db } from '@/db/client';
import {
  appSettings,
  bodyMetrics,
  cardioSegments,
  exercises,
  routineExercises,
  routines,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';
import { toDateKey } from '@/lib/format';

export const BACKUP_FORMAT_VERSION = 1;

/** Bu sürümün okuyabildiği yedek formatları */
const SUPPORTED_FORMAT_VERSIONS = [1];

export interface BackupFile {
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

/** db.transaction'ın callback'ine verdiği işlem nesnesi */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Tablolar **ebeveynden çocuğa** sırada. Yazarken bu sıra, silerken
 * tersi kullanılır — `PRAGMA foreign_keys = ON` aktif olduğu için
 * sıra artık gerçekten önemli.
 *
 * `appSettings` hiçbir tabloya bağlı değil, listenin başında durması
 * yeterli.
 */
const BACKUP_TABLES = [
  { key: 'appSettings', table: appSettings },
  { key: 'exercises', table: exercises },
  { key: 'routines', table: routines },
  { key: 'bodyMetrics', table: bodyMetrics },
  { key: 'routineExercises', table: routineExercises },
  { key: 'workoutSessions', table: workoutSessions },
  { key: 'sessionExercises', table: sessionExercises },
  { key: 'cardioSegments', table: cardioSegments },
  { key: 'sets', table: sets },
] as const satisfies readonly { key: string; table: SQLiteTable }[];

/** Yedekte bulunması beklenen tablo anahtarları */
export const BACKUP_TABLE_KEYS = BACKUP_TABLES.map((t) => t.key);

/** "Tüm verileri sıfırla" ve geri yüklemede temizlenen kullanıcı tabloları */
const USER_DATA_TABLES = BACKUP_TABLES.filter(
  (t) => t.key !== 'exercises' && t.key !== 'appSettings'
);

/** Tablo anahtarı → kullanıcıya gösterilecek ad */
export const TABLE_LABELS: Record<string, string> = {
  appSettings: 'Ayarlar',
  exercises: 'Egzersiz',
  routines: 'Rutin',
  bodyMetrics: 'Ölçüm',
  routineExercises: 'Rutin egzersizi',
  workoutSessions: 'Antrenman',
  sessionExercises: 'Seans egzersizi',
  cardioSegments: 'Kardiyo',
  sets: 'Set',
};

/**
 * SQLite'ın tek sorguda bağlayabildiği parametre sayısı sınırlı; satır
 * başına kolon sayısına göre batch büyüklüğü hesaplıyoruz (seed.ts'teki
 * 100'erli batch mantığının kolon sayısına duyarlı hali).
 */
const MAX_BIND_PARAMS = 900;

function batchSizeFor(table: SQLiteTable): number {
  const columnCount = Object.keys(getTableColumns(table)).length || 1;
  return Math.max(1, Math.floor(MAX_BIND_PARAMS / columnCount));
}

/**
 * Tüm tabloları okuyup BackupFile nesnesi üretir.
 *
 * `appVersion` dışarıdan veriliyor: uygulama sürümünü okumak
 * `expo-constants` gerektiriyor, bu modül Expo'ya bağlı kalmasın diye
 * çağıran taraf (`src/lib/backupFile.ts`) geçiriyor.
 */
export async function buildBackup(
  db: Db,
  appVersion: string = '0.0.0'
): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const { key, table } of BACKUP_TABLES) {
    tables[key] = await db.select().from(table);
  }

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/** `fitness-yedek-2026-09-15.json` */
export function backupFileName(date: Date = new Date()): string {
  return `fitness-yedek-${toDateKey(date)}.json`;
}

/** Yedek dosyasındaki kayıt sayıları — özet göstermek için */
export function countRecords(data: BackupFile): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of BACKUP_TABLE_KEYS) {
    counts[key] = data.tables[key]?.length ?? 0;
  }
  return counts;
}

export type ValidationResult =
  | { ok: true; data: BackupFile }
  | { ok: false; error: string };

/**
 * JSON metnini doğrular. Hata mesajı hangi sorunun olduğunu söylesin —
 * kullanıcı "geçersiz dosya" görüp ne yapacağını bilemesin istemiyoruz.
 */
export function validateBackup(raw: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: 'Dosya okunabilir bir JSON değil. Yedek dosyasını seçtiğinden emin ol.',
    };
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Dosyanın içeriği bir yedek nesnesi değil.' };
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.formatVersion !== 'number') {
    return {
      ok: false,
      error: 'Dosyada "formatVersion" alanı yok. Bu bir fitness yedeği değil.',
    };
  }
  if (!SUPPORTED_FORMAT_VERSIONS.includes(obj.formatVersion)) {
    return {
      ok: false,
      error: `Yedek formatı ${obj.formatVersion}, bu sürüm yalnızca ${SUPPORTED_FORMAT_VERSIONS.join(', ')} formatını okuyabiliyor. Uygulamayı güncellemen gerekebilir.`,
    };
  }

  if (
    obj.tables == null ||
    typeof obj.tables !== 'object' ||
    Array.isArray(obj.tables)
  ) {
    return { ok: false, error: 'Dosyada "tables" bölümü yok ya da bozuk.' };
  }

  const tables = obj.tables as Record<string, unknown>;

  const missing = BACKUP_TABLE_KEYS.filter((key) => tables[key] === undefined);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Yedekte şu tablolar eksik: ${missing.join(', ')}.`,
    };
  }

  const notArray = BACKUP_TABLE_KEYS.filter((key) => !Array.isArray(tables[key]));
  if (notArray.length > 0) {
    return {
      ok: false,
      error: `Şu tablolar liste biçiminde değil: ${notArray.join(', ')}.`,
    };
  }

  const notObjectRows = BACKUP_TABLE_KEYS.filter((key) =>
    (tables[key] as unknown[]).some(
      (row) => row == null || typeof row !== 'object' || Array.isArray(row)
    )
  );
  if (notObjectRows.length > 0) {
    return {
      ok: false,
      error: `Şu tablolarda tanınmayan satırlar var: ${notObjectRows.join(', ')}.`,
    };
  }

  return {
    ok: true,
    data: {
      formatVersion: obj.formatVersion,
      appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'bilinmiyor',
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      tables: tables as Record<string, unknown[]>,
    },
  };
}

/**
 * Mevcut veriyi tamamen silip yedektekiyle değiştirir.
 *
 * Tamamı tek transaction: yarıda kalırsa kullanıcı hem eski hem yeni
 * veriden olurdu.
 */
export async function restoreBackup(db: Db, data: BackupFile): Promise<void> {
  await db.transaction(async (tx) => {
    await deleteAllTables(tx);

    // Ebeveynden çocuğa
    for (const { key, table } of BACKUP_TABLES) {
      const rows = data.tables[key] ?? [];
      if (rows.length > 0) await insertBatched(tx, table, rows);
    }
  });
}

/**
 * Kullanıcı verisini siler; egzersiz kütüphanesine ve ayarlara dokunmaz.
 * Kütüphane silinirse yeniden indirmek gerekir, ayarlar da (boy, doğum
 * tarihi, tercihler) kullanıcının "verisi" değil kurulumu.
 */
export async function wipeUserData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    // Çocuktan ebeveyne
    for (const { table } of [...USER_DATA_TABLES].reverse()) {
      await tx.delete(table);
    }
  });
}

// ============================================================================
// Yardımcılar
// ============================================================================

async function deleteAllTables(tx: Tx): Promise<void> {
  // Çocuktan ebeveyne: sets → sessionExercises → cardioSegments →
  // workoutSessions → routineExercises → bodyMetrics → routines →
  // exercises → appSettings
  for (const { table } of [...BACKUP_TABLES].reverse()) {
    await tx.delete(table);
  }
}

async function insertBatched(
  tx: Tx,
  table: SQLiteTable,
  rows: unknown[]
): Promise<void> {
  const size = batchSizeFor(table);
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size) as Record<string, unknown>[];
    await tx.insert(table).values(batch);
  }
}
