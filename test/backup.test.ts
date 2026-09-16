/**
 * Yedekleme / geri yükleme — en kritik test dosyası.
 *
 * Buradaki bir hata kullanıcının tüm geçmişini kaybettirir: geri yükleme
 * önce her şeyi siliyor. Gidiş-dönüş testinin amacı "yedek alındı" diyen
 * bir dosyanın gerçekten geri yüklenebildiğini kanıtlamak.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLE_KEYS,
  backupFileName,
  buildBackup,
  countRecords,
  restoreBackup,
  validateBackup,
  wipeUserData,
} from '@/lib/backup';
import { getLastSessionForExercise } from '@/lib/lastSession';
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
import {
  countRows,
  createCardioSegment,
  createCompletedSession,
  createRoutine,
  createTestDb,
  seedExercise,
  type TestDb,
} from './helpers/testDb';

let testDb: TestDb;
let db: Db;

beforeEach(() => {
  testDb = createTestDb();
  db = testDb.db;
});

afterEach(() => {
  testDb.close();
});

/** Testlerde kullanılan tipik veri seti */
async function seedFullDatabase(db: Db) {
  await db.insert(appSettings).values({
    id: 1,
    heightCm: 178,
    birthDate: '1990-03-15',
    gender: 'male',
    defaultRestSeconds: 120,
    restTimerVibrate: false,
  });

  const bench = await seedExercise(db, { name: 'Bench Press' });
  const squat = await seedExercise(db, { name: 'Squat' });
  const treadmill = await seedExercise(db, {
    name: 'Treadmill',
    category: 'cardio',
  });

  const { routineId } = await createRoutine(db, {
    name: 'Push Günü',
    exerciseIds: [bench, squat],
    restSeconds: 120,
  });

  const older = await createCompletedSession(db, {
    exerciseId: bench,
    routineId,
    startedAt: '2026-09-01T10:00:00.000Z',
    setSeeds: [
      { reps: 10, weightKg: 60 },
      { reps: 8, weightKg: 65 },
    ],
  });
  const newer = await createCompletedSession(db, {
    exerciseId: bench,
    routineId,
    startedAt: '2026-09-10T10:00:00.000Z',
    setSeeds: [
      { reps: 10, weightKg: 70 },
      { reps: 8, weightKg: 75 },
      { reps: 6, weightKg: 80, isCompleted: false },
    ],
  });
  await createCardioSegment(db, {
    sessionId: newer.sessionId,
    exerciseId: treadmill,
  });

  await db.insert(bodyMetrics).values([
    { id: 'bm-1', date: '2026-09-01', weightKg: 82.5, waistCm: 85 },
    { id: 'bm-2', date: '2026-09-08', weightKg: 82.1, waistCm: 84.5 },
  ]);

  return { bench, squat, treadmill, routineId, older, newer };
}

const ALL_TABLES = [
  appSettings,
  exercises,
  routines,
  bodyMetrics,
  routineExercises,
  workoutSessions,
  sessionExercises,
  cardioSegments,
  sets,
];

async function snapshotCounts(db: Db): Promise<number[]> {
  const out: number[] = [];
  for (const table of ALL_TABLES) out.push(await countRows(db, table));
  return out;
}

describe('gidiş-dönüş', () => {
  it('yedek al → sil → geri yükle: satır sayıları ve içerik aynı', async () => {
    await seedFullDatabase(db);

    const before = await buildBackup(db, '0.1.0');
    const countsBefore = await snapshotCounts(db);

    await wipeUserData(db);
    await restoreBackup(db, before);

    expect(await snapshotCounts(db)).toEqual(countsBefore);

    const after = await buildBackup(db, '0.1.0');
    for (const key of BACKUP_TABLE_KEYS) {
      expect(sortRows(after.tables[key]!), key).toEqual(
        sortRows(before.tables[key]!)
      );
    }
  });

  it('geri yükleme sonrası ilişkiler ve auto-fill hâlâ doğru', async () => {
    const { bench, newer } = await seedFullDatabase(db);

    const expected = await getLastSessionForExercise(db, bench, newer.sessionId);
    expect(expected).not.toBeNull();

    const backup = await buildBackup(db, '0.1.0');
    await wipeUserData(db);
    await restoreBackup(db, backup);

    const actual = await getLastSessionForExercise(db, bench, newer.sessionId);
    expect(actual).toEqual(expected);

    // seans → egzersiz → set zinciri: join'ler boş dönmüyor
    const chain = await db
      .select({ setId: sets.id, exerciseId: sessionExercises.exerciseId })
      .from(sets)
      .innerJoin(
        sessionExercises,
        eq(sets.sessionExerciseId, sessionExercises.id)
      )
      .innerJoin(
        workoutSessions,
        eq(sessionExercises.sessionId, workoutSessions.id)
      );
    expect(chain.length).toBe(await countRows(db, sets));
  });

  it('boş veritabanına geri yükleme de çalışıyor', async () => {
    await seedFullDatabase(db);
    const backup = await buildBackup(db, '0.1.0');
    const counts = await snapshotCounts(db);

    const fresh = createTestDb();
    try {
      await restoreBackup(fresh.db, backup);
      expect(await snapshotCounts(fresh.db)).toEqual(counts);
    } finally {
      fresh.close();
    }
  });

  it('countRecords yedekteki satır sayılarını veriyor', async () => {
    await seedFullDatabase(db);
    const backup = await buildBackup(db, '0.1.0');

    const counts = countRecords(backup);
    expect(counts.exercises).toBe(3);
    expect(counts.routines).toBe(1);
    expect(counts.workoutSessions).toBe(2);
    expect(counts.sets).toBe(5);
    expect(counts.bodyMetrics).toBe(2);
    expect(counts.appSettings).toBe(1);
  });

  it('buildBackup verilen appVersion ve format sürümünü yazıyor', async () => {
    const backup = await buildBackup(db, '1.2.3');
    expect(backup.appVersion).toBe('1.2.3');
    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(Object.keys(backup.tables).sort()).toEqual(
      [...BACKUP_TABLE_KEYS].sort()
    );
  });
});

describe('wipeUserData', () => {
  it('egzersiz kütüphanesini ve ayarları silmiyor', async () => {
    await seedFullDatabase(db);

    await wipeUserData(db);

    expect(await countRows(db, exercises)).toBe(3);
    expect(await countRows(db, appSettings)).toBe(1);

    expect(await countRows(db, routines)).toBe(0);
    expect(await countRows(db, routineExercises)).toBe(0);
    expect(await countRows(db, workoutSessions)).toBe(0);
    expect(await countRows(db, sessionExercises)).toBe(0);
    expect(await countRows(db, cardioSegments)).toBe(0);
    expect(await countRows(db, sets)).toBe(0);
    expect(await countRows(db, bodyMetrics)).toBe(0);
  });

  it('ayar değerleri olduğu gibi kalıyor', async () => {
    await seedFullDatabase(db);

    await wipeUserData(db);

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1));
    expect(rows[0]?.defaultRestSeconds).toBe(120);
    expect(rows[0]?.heightCm).toBe(178);
  });
});

describe('validateBackup', () => {
  it('geçerli yedeği kabul ediyor', async () => {
    await seedFullDatabase(db);
    const raw = JSON.stringify(await buildBackup(db, '0.1.0'));

    const result = validateBackup(raw);
    expect(result.ok).toBe(true);
  });

  it('bozuk JSON', () => {
    const result = validateBackup('{ bu json değil');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/JSON/i);
  });

  it('nesne değil (dizi)', () => {
    const result = validateBackup('[1,2,3]');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/yedek nesnesi değil/i);
  });

  it('eksik formatVersion', () => {
    const result = validateBackup(JSON.stringify({ tables: {} }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/formatVersion/);
  });

  it('desteklenmeyen sürüm', () => {
    const result = validateBackup(
      JSON.stringify({ formatVersion: 99, tables: {} })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/99/);
    expect(result.ok === false && result.error).toMatch(/güncelle/i);
  });

  it('tables bölümü yok', () => {
    const result = validateBackup(JSON.stringify({ formatVersion: 1 }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/tables/);
  });

  it('eksik tablo adını söylüyor', () => {
    const tables: Record<string, unknown[]> = {};
    for (const key of BACKUP_TABLE_KEYS) tables[key] = [];
    delete tables.sets;

    const result = validateBackup(JSON.stringify({ formatVersion: 1, tables }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/eksik/i);
    expect(result.ok === false && result.error).toMatch(/sets/);
  });

  it('tablo dizi değilse söylüyor', () => {
    const tables: Record<string, unknown> = {};
    for (const key of BACKUP_TABLE_KEYS) tables[key] = [];
    tables.sets = { nope: true };

    const result = validateBackup(JSON.stringify({ formatVersion: 1, tables }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/liste biçiminde/i);
    expect(result.ok === false && result.error).toMatch(/sets/);
  });

  it('satırlar nesne değilse söylüyor', () => {
    const tables: Record<string, unknown> = {};
    for (const key of BACKUP_TABLE_KEYS) tables[key] = [];
    tables.sets = ['merhaba'];

    const result = validateBackup(JSON.stringify({ formatVersion: 1, tables }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/tanınmayan satırlar/i);
  });

  it('eksik appVersion / exportedAt yedeği geçersiz kılmıyor', () => {
    const tables: Record<string, unknown[]> = {};
    for (const key of BACKUP_TABLE_KEYS) tables[key] = [];

    const result = validateBackup(JSON.stringify({ formatVersion: 1, tables }));
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data.appVersion).toBe('bilinmiyor');
    expect(result.ok === true && result.data.exportedAt).toBe('');
  });
});

describe('büyük veri', () => {
  it('500+ set içeren yedek sorunsuz geri yükleniyor (batch sınırı)', async () => {
    const exerciseId = await seedExercise(db);
    const { sessionExerciseId } = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-09-10T10:00:00.000Z',
    });

    const manySets = Array.from({ length: 640 }, (_, i) => ({
      id: `bulk-set-${i}`,
      sessionExerciseId,
      setNumber: i + 1,
      reps: 10,
      weightKg: 60 + (i % 20),
      isCompleted: true,
    }));
    // Kurulumun kendisi de batch'lensin; tek insert bind sınırını aşar
    for (let i = 0; i < manySets.length; i += 50) {
      await db.insert(sets).values(manySets.slice(i, i + 50));
    }

    expect(await countRows(db, sets)).toBe(640);

    const backup = await buildBackup(db, '0.1.0');
    await wipeUserData(db);
    expect(await countRows(db, sets)).toBe(0);

    await restoreBackup(db, backup);

    expect(await countRows(db, sets)).toBe(640);
    const rows = await db.select().from(sets).where(eq(sets.id, 'bulk-set-639'));
    expect(rows[0]?.setNumber).toBe(640);
  });
});

describe('restoreBackup atomikliği', () => {
  it('geçersiz satırda hata atıyor ve eski veri geri geliyor', async () => {
    await seedFullDatabase(db);
    const good = await buildBackup(db, '0.1.0');

    // sets satırı var olmayan bir session_exercise'a işaret ediyor →
    // FK ihlali, transaction geri alınmalı
    const broken = {
      ...good,
      tables: {
        ...good.tables,
        sets: [
          {
            id: 'kirik',
            sessionExerciseId: 'yok-boyle-bir-sey',
            setNumber: 1,
            setType: 'normal',
            isCompleted: true,
          },
        ],
      },
    };

    await expect(restoreBackup(db, broken)).rejects.toThrow();

    // Rollback sonrası eski veri yerinde
    expect(await countRows(db, sets)).toBe(5);
    expect(await countRows(db, workoutSessions)).toBe(2);
  });
});

describe('backupFileName', () => {
  it('yerel tarihle adlandırıyor', () => {
    expect(backupFileName(new Date(2026, 8, 15, 23, 30))).toBe(
      'fitness-yedek-2026-09-15.json'
    );
  });
});

/** Satır sıralaması sürücüye göre değişebilir; karşılaştırmadan önce sabitle */
function sortRows(rows: unknown[]): unknown[] {
  return [...rows].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
}
