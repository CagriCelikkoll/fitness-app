/**
 * v3.1a eşitleme — yerel migration (`drizzle/0001_sync.sql`).
 *
 * - Migration yalnızca ekleme yapıyor: temiz ve dolu veritabanında
 *   çalışıyor, tekrar çalıştırılınca bozulmuyor, öncesi ve sonrası
 *   alınan yedekler birebir aynı (gerçek yedek varsa onunla da).
 * - Takip kapalıyken (varsayılan) bütün yazma yollarından sonra giden
 *   kutusu boş ve sonuç migration öncesiyle aynı.
 * - Takip açıkken ekleme / güncelleme / silme / cascade / rutin bağının
 *   boşalması / "sil + yeniden yaz" doğru kaydediliyor; yarım antrenman
 *   kuralı (tasarım 1.4); susturma (1.1, 1.2); trigger'lar yazmaları
 *   bozmuyor (1.5).
 *
 * Gerçek yedek: `test/fixtures/*.local.json` (git'e girmez). Yoksa o
 * test atlanır; aynı test sentetik bir yıllık veriyle her zaman çalışır.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  syncOutbox,
  syncState,
  workoutSessions,
} from '@/db/schema';
import { applyTemplate } from '@/lib/applyTemplate';
import {
  buildBackup,
  restoreBackup,
  validateBackup,
  wipeUserData,
  type BackupFile,
} from '@/lib/backup';
import { finishSessionRecord } from '@/lib/finishSession';
import { newId } from '@/lib/id';
import { saveSessionExerciseNote, saveSessionNote } from '@/lib/notes';
import { applySuggestedWeight } from '@/lib/progression';
import { deleteStaleEmptySessions, discardSession } from '@/lib/sessionRecovery';
import { createSessionFromRoutine } from '@/lib/startSession';
import { readSyncState, startTracking, withSyncSuppressed } from '@/lib/syncState';
import { WORKOUT_TEMPLATES } from '@/lib/workoutTemplates';

import { __resetUuidCounter } from './stubs/expo-crypto';
import { applyMigrations, createTestDb, type TestDb } from './helpers/testDb';
import { buildSyntheticYearBackup } from './helpers/syntheticBackup';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const BEFORE = '0000_initial';

const opened: TestDb[] = [];
function open(options: { upTo?: string } = {}): TestDb {
  const t = createTestDb(options);
  opened.push(t);
  return t;
}
afterEach(() => {
  while (opened.length > 0) opened.pop()!.close();
  vi.useRealTimers();
});

/** backup.ts'teki sıra (ebeveynden çocuğa) — eski sürümün geri yüklemesi */
const TABLES_IN_ORDER = [
  ['appSettings', appSettings],
  ['exercises', exercises],
  ['routines', routines],
  ['bodyMetrics', bodyMetrics],
  ['routineExercises', routineExercises],
  ['workoutSessions', workoutSessions],
  ['sessionExercises', sessionExercises],
  ['cardioSegments', cardioSegments],
  ['sets', sets],
] as const;

/**
 * Yedeği eski şemaya (yalnızca 0000) yükler. `restoreBackup` artık
 * `sync_state`'e de yazdığı için orada çalışmaz; eski sürümün yaptığı
 * düz insert'ün aynısı.
 */
async function loadIntoOldSchema(db: Db, data: BackupFile): Promise<void> {
  for (const [key, table] of TABLES_IN_ORDER) {
    const rows = (data.tables[key] ?? []) as Record<string, unknown>[];
    for (let i = 0; i < rows.length; i += 30) {
      await db.insert(table).values(rows.slice(i, i + 30) as never);
    }
  }
}

const outbox = (t: TestDb) =>
  t.sqlite
    .prepare('select table_name, row_id, session_id from sync_outbox order by table_name, row_id')
    .all() as { table_name: string; row_id: string; session_id: string | null }[];

const outboxIds = (t: TestDb, table: string) =>
  outbox(t)
    .filter((e) => e.table_name === table)
    .map((e) => e.row_id)
    .sort();

const rowExists = (t: TestDb, table: string, id: string) =>
  t.sqlite.prepare(`select 1 from ${table} where id = ?`).get(id) != null;

// ============================================================================
// Migration
// ============================================================================

describe('migration: yalnızca ekleme', () => {
  it('temiz veritabanında: 2 tablo, 22 trigger, takip kapalı', async () => {
    const t = open();
    const names = (type: string) =>
      (
        t.sqlite
          .prepare(`select name from sqlite_master where type = ? and name not like 'sqlite_%' order by name`)
          .all(type) as { name: string }[]
      ).map((r) => r.name);
    expect(names('table')).toEqual(
      [
        '__drizzle_migrations',
        'app_settings',
        'body_metrics',
        'cardio_segments',
        'exercises',
        'routine_exercises',
        'routines',
        'session_exercises',
        'sets',
        'sync_outbox',
        'sync_state',
        'workout_sessions',
      ].sort()
    );
    expect(names('trigger')).toHaveLength(22);
    // body_metrics, exercises, app_settings izlenmiyor
    expect(names('trigger').some((n) => /^sync_(body_metrics|exercises|app_settings)_/.test(n))).toBe(
      false
    );
    expect(await readSyncState(t.db)).toMatchObject({
      id: 1,
      tracking: false,
      suppress: false,
      ownerUserId: null,
      initialUploadDone: false,
      pullCursor: null,
    });
    expect(outbox(t)).toEqual([]);
  });

  it('mevcut tabloların tanımı değişmiyor', () => {
    const schemaOf = (t: TestDb) =>
      t.sqlite
        .prepare(
          `select type, name, sql from sqlite_master
           where name not like '%sync%' and name not like '%drizzle%'
             and type in ('table', 'index')
           order by name`
        )
        .all();
    const before = open({ upTo: BEFORE });
    const after = open();
    expect(schemaOf(after)).toEqual(schemaOf(before));
  });

  it('dolu veritabanında çalışıyor, ikinci kez çalıştırılınca bozulmuyor', async () => {
    const t = open({ upTo: BEFORE });
    const data = buildSyntheticYearBackup({ sessions: 30 });
    await loadIntoOldSchema(t.db, data);

    applyMigrations(t);
    await t.db.update(syncState).set({ tracking: true, ownerUserId: 'u1' });
    applyMigrations(t); // no-op: sync_state korunuyor, satır çiftlenmiyor

    expect(t.sqlite.prepare('select count(*) c from sync_state').get()).toEqual({ c: 1 });
    expect(await readSyncState(t.db)).toMatchObject({ tracking: true, ownerUserId: 'u1' });
    expect((await buildBackup(t.db)).tables).toEqual(data.tables);
  });
});

// ============================================================================
// Yedek: migration öncesi ve sonrası birebir aynı
// ============================================================================

async function expectBackupUnchangedByMigration(data: BackupFile): Promise<void> {
  const t = open({ upTo: BEFORE });
  await loadIntoOldSchema(t.db, data);
  const before = await buildBackup(t.db, '0.10.0');

  applyMigrations(t);
  const after = await buildBackup(t.db, '0.10.0');

  expect(after.formatVersion).toBe(before.formatVersion);
  expect(Object.keys(after.tables)).toEqual(Object.keys(before.tables));
  expect(after.tables).toEqual(before.tables);
  // Bayt bayt: JSON metni de aynı (dışa aktarım zamanı hariç)
  const text = (b: BackupFile) => JSON.stringify({ ...b, exportedAt: '' });
  expect(text(after)).toBe(text(before));
  expect(outbox(t)).toEqual([]);

  // Eski yedek yeni şemaya yükleniyor, aynısı geri çıkıyor
  const fresh = open();
  await restoreBackup(fresh.db, data);
  expect((await buildBackup(fresh.db)).tables).toEqual(before.tables);
  expect(outbox(fresh)).toEqual([]);
}

describe('yedek: migration öncesi ve sonrası aynı', () => {
  it('sentetik bir yıllık kullanıcı (~6.500 satır)', async () => {
    const data = buildSyntheticYearBackup();
    expect(data.tables.sets.length).toBe(4800);
    await expectBackupUnchangedByMigration(data);
  });

  const realBackups = (() => {
    try {
      return readdirSync(FIXTURES).filter((f) => f.endsWith('.local.json'));
    } catch {
      return [];
    }
  })();

  it.skipIf(realBackups.length === 0)(
    `gerçek yedek (test/fixtures/*.local.json): ${realBackups.join(', ') || 'yok, atlandı'}`,
    async () => {
      for (const file of realBackups) {
        const result = validateBackup(readFileSync(path.join(FIXTURES, file), 'utf8'));
        if (!result.ok) throw new Error(`${file}: ${result.error}`);
        await expectBackupUnchangedByMigration(result.data);
      }
    },
    60_000
  );
});

// ============================================================================
// Bütün yazma yolları: takip kapalı / açık / migration öncesi aynı sonuç
// ============================================================================

const FIXED_NOW = new Date('2026-10-11T10:00:00.000Z');

/**
 * Uygulamadaki yazma yollarının hepsi, uygulamadaki fonksiyonlarla ya da
 * ekrandaki kodun aynısıyla. Kimlikler ve saat sabit: iki veritabanında
 * aynı sonuç beklenir.
 */
async function runAllWriteFlows(db: Db, options: { backupFlows: boolean }): Promise<void> {
  const template = WORKOUT_TEMPLATES[0];
  const ids = [...new Set(template.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)))];
  await db.insert(exercises).values(
    ids.map((id) => ({ id, name: id, primaryMuscles: '[]', category: 'strength' }))
  );

  // Hazır program → rutinler
  const routineIds = await applyTemplate(db, template);

  // Rutin düzenleme: app/routine/[id].tsx "sil + yeniden yaz"
  const r0 = routineIds[0];
  const current = await db
    .select()
    .from(routineExercises)
    .where(eq(routineExercises.routineId, r0))
    .orderBy(asc(routineExercises.orderIndex));
  const rows = [
    ...current.slice(0, 3).map((re, idx) => ({ ...re, orderIndex: idx })),
    { ...current[0], id: newId(), orderIndex: 3, targetSets: 2 },
  ];
  await db.transaction(async (tx) => {
    await tx
      .update(routines)
      .set({ name: 'İtme (düzenlendi)', description: null, updatedAt: new Date().toISOString() })
      .where(eq(routines.id, r0));
    await tx.delete(routineExercises).where(eq(routineExercises.routineId, r0));
    await tx.insert(routineExercises).values(rows);
  });

  // Antrenman 1: başlat, set gir (active.tsx), öneri uygula, not, bitir (boşları sil)
  const s1 = (await createSessionFromRoutine(db, { id: r0, name: 'İtme' }))!;
  const se1 = await db
    .select()
    .from(sessionExercises)
    .where(eq(sessionExercises.sessionId, s1))
    .orderBy(asc(sessionExercises.orderIndex));
  const firstSets = await db
    .select()
    .from(sets)
    .where(eq(sets.sessionExerciseId, se1[0].id))
    .orderBy(asc(sets.setNumber));
  await db.update(sets).set({ weightKg: 60 }).where(eq(sets.id, firstSets[0].id));
  await db.update(sets).set({ reps: 8 }).where(eq(sets.id, firstSets[0].id));
  await db
    .update(sets)
    .set({ isCompleted: true, completedAt: new Date().toISOString() })
    .where(eq(sets.id, firstSets[0].id));
  await db.insert(sets).values({
    id: newId(),
    sessionExerciseId: se1[0].id,
    setNumber: firstSets.length + 1,
    setType: 'normal',
    isCompleted: false,
  });
  await applySuggestedWeight(db, se1[1].id, 82.5);
  await saveSessionExerciseNote(db, se1[0].id, '  Omuz iyi  ');
  await finishSessionRecord(db, {
    sessionId: s1,
    sessionExerciseIds: se1.map((s) => s.id),
    pendingFilledIds: [],
    mode: 'delete',
  });
  await saveSessionNote(db, s1, 'Güzel antrenman');

  // Antrenman 2: doldurulmuş ama onaylanmamış set "tamamlanmış say"
  const s2 = (await createSessionFromRoutine(db, { id: routineIds[1], name: 'Çekme' }))!;
  const se2 = await db.select().from(sessionExercises).where(eq(sessionExercises.sessionId, s2));
  const pending = await db
    .select()
    .from(sets)
    .where(eq(sets.sessionExerciseId, se2[0].id))
    .limit(1);
  await db.update(sets).set({ weightKg: 40, reps: 10 }).where(eq(sets.id, pending[0].id));
  await finishSessionRecord(db, {
    sessionId: s2,
    sessionExerciseIds: se2.map((s) => s.id),
    pendingFilledIds: [pending[0].id],
    mode: 'complete',
  });

  // Yarım kalan antrenmandan vazgeç
  const s3 = (await createSessionFromRoutine(db, { id: routineIds[2], name: 'Bacak' }))!;
  await discardSession(db, s3);

  // Eski, boş, yarım antrenman temizliği
  await db.insert(workoutSessions).values({
    id: newId(),
    name: 'Boş',
    startedAt: new Date(FIXED_NOW.getTime() - 24 * 3600_000).toISOString(),
  });
  await deleteStaleEmptySessions(db, FIXED_NOW.getTime());

  // Rutin silme (workout.tsx): antrenman 2'nin rutin bağı boşalır
  await db.delete(routines).where(eq(routines.id, routineIds[1]));

  // Geçmişten antrenman silme (session/[id].tsx)
  await db.delete(workoutSessions).where(eq(workoutSessions.id, s1));

  if (options.backupFlows) {
    const backup = await buildBackup(db);
    await wipeUserData(db);
    await restoreBackup(db, backup);
  }
}

/** Karşılaştırma için tablo dökümü; SQLite'ın `current_timestamp`'i hariç */
async function dump(db: Db) {
  const { tables } = await buildBackup(db);
  return Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [
      k,
      (rows as Record<string, unknown>[]).map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest),
    ])
  );
}

async function runFlowsOn(t: TestDb, options: { backupFlows: boolean; track?: boolean }) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
  if (options.track) await startTracking(t.db, 'u1');
  __resetUuidCounter();
  await runAllWriteFlows(t.db, options);
  vi.useRealTimers();
  return dump(t.db);
}

describe('takip kapalı (varsayılan): davranış aynı, giden kutusu boş', () => {
  it('bütün yazma yollarından sonra giden kutusu boş, sonuç migration öncesiyle aynı', async () => {
    const old = open({ upTo: BEFORE });
    const now = open();
    const expected = await runFlowsOn(old, { backupFlows: false });
    expect(await runFlowsOn(now, { backupFlows: false })).toEqual(expected);
    expect(outbox(now)).toEqual([]);
  });

  it('sıfırlama ve geri yükleme dahil: giden kutusu boş', async () => {
    const t = open();
    await runFlowsOn(t, { backupFlows: true });
    expect(outbox(t)).toEqual([]);
    expect(await readSyncState(t.db)).toMatchObject({ tracking: false, suppress: false });
  });

  it('trigger açıkken de yazmalar aynı sonucu veriyor (1.5)', async () => {
    const off = open();
    const on = open();
    const expected = await runFlowsOn(off, { backupFlows: true });
    expect(await runFlowsOn(on, { backupFlows: true, track: true })).toEqual(expected);
  });

  it('durum satırı yoksa trigger sessizce çalışmıyor, yazma bozulmuyor', async () => {
    const t = open();
    t.sqlite.exec('delete from sync_state');
    await runAllWriteFlows(t.db, { backupFlows: false });
    expect(outbox(t)).toEqual([]);
  });
});

// ============================================================================
// Takip açık
// ============================================================================

describe('takip açık: değişiklikler giden kutusuna', () => {
  let t: TestDb;
  let exA: string;
  let exB: string;
  beforeEach(async () => {
    t = open();
    exA = 'Barbell_Bench_Press_-_Medium_Grip';
    exB = 'Barbell_Squat';
    await t.db.insert(exercises).values([
      { id: exA, name: 'Bench', primaryMuscles: '[]', category: 'strength' },
      { id: exB, name: 'Squat', primaryMuscles: '[]', category: 'strength' },
    ]);
    await startTracking(t.db, 'u1');
  });

  async function routineWith(n: number) {
    const id = newId();
    await t.db.insert(routines).values({ id, name: 'R' });
    const reIds = Array.from({ length: n }, () => newId());
    if (n === 0) return { id, reIds };
    await t.db.insert(routineExercises).values(
      reIds.map((reId, i) => ({ id: reId, routineId: id, exerciseId: i % 2 ? exB : exA, orderIndex: i }))
    );
    return { id, reIds };
  }

  async function finishedSession(routineId: string) {
    const sessionId = (await createSessionFromRoutine(t.db, { id: routineId, name: 'R' }))!;
    const ses = await t.db
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, sessionId));
    const setRows = await t.db.select().from(sets);
    await t.db.update(sets).set({ isCompleted: true, reps: 5, weightKg: 50 });
    await finishSessionRecord(t.db, {
      sessionId,
      sessionExerciseIds: ses.map((s) => s.id),
      pendingFilledIds: [],
      mode: 'delete',
    });
    return { sessionId, seIds: ses.map((s) => s.id), setIds: setRows.map((s) => s.id) };
  }

  it('ekleme ve güncelleme kaydediliyor; aynı satır tek kayıt, zaman ilerliyor', async () => {
    const { id } = await routineWith(0);
    const first = t.sqlite.prepare('select changed_at from sync_outbox where row_id = ?').get(id) as {
      changed_at: string;
    };
    await new Promise((r) => setTimeout(r, 5));
    await t.db.update(routines).set({ name: 'Yeni' }).where(eq(routines.id, id));
    const rows = t.sqlite.prepare('select changed_at from sync_outbox where row_id = ?').all(id) as {
      changed_at: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].changed_at > first.changed_at).toBe(true);
    expect(rows[0].changed_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it('rutin silme: rutin, cascade ile rutin egzersizleri ve bağı boşalan antrenman', async () => {
    const r = await routineWith(2);
    const { sessionId } = await finishedSession(r.id);
    await t.db.delete(syncOutbox);

    await t.db.delete(routines).where(eq(routines.id, r.id));

    expect(outboxIds(t, 'routines')).toEqual([r.id]);
    expect(outboxIds(t, 'routine_exercises')).toEqual([...r.reIds].sort());
    expect(outboxIds(t, 'workout_sessions')).toEqual([sessionId]);
    expect(rowExists(t, 'workout_sessions', sessionId)).toBe(true); // upsert, routine_id null
    expect(rowExists(t, 'routines', r.id)).toBe(false); // silme
  });

  it('rutin silme, antrenmanın kaydı giden kutusundayken de çalışıyor (set null + upsert)', async () => {
    // INSERT OR REPLACE ile bu silme UNIQUE hatasıyla geri alınıyordu:
    // SET NULL içinden tetiklenen trigger'da REPLACE yok sayılıyor.
    const r = await routineWith(1);
    const { sessionId } = await finishedSession(r.id);
    expect(outboxIds(t, 'workout_sessions')).toEqual([sessionId]);

    await t.db.delete(routines).where(eq(routines.id, r.id));

    expect(rowExists(t, 'routines', r.id)).toBe(false);
    const [ws] = await t.db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId));
    expect(ws.routineId).toBeNull();
    expect(outbox(t).filter((e) => e.table_name === 'workout_sessions')).toEqual([
      { table_name: 'workout_sessions', row_id: sessionId, session_id: sessionId },
    ]);
  });

  it('rutin "sil + yeniden yaz": kalanlar upsert, çıkarılanlar silme, yeniler ekleme', async () => {
    const r = await routineWith(3);
    await t.db.delete(syncOutbox);
    const [keep, , removed] = r.reIds;
    const added = newId();

    await t.db.transaction(async (tx) => {
      await tx.delete(routineExercises).where(eq(routineExercises.routineId, r.id));
      await tx.insert(routineExercises).values([
        { id: keep, routineId: r.id, exerciseId: exA, orderIndex: 0 },
        { id: r.reIds[1], routineId: r.id, exerciseId: exB, orderIndex: 1 },
        { id: added, routineId: r.id, exerciseId: exA, orderIndex: 2 },
      ]);
    });

    expect(outboxIds(t, 'routine_exercises')).toEqual([keep, r.reIds[1], removed, added].sort());
    expect(rowExists(t, 'routine_exercises', keep)).toBe(true);
    expect(rowExists(t, 'routine_exercises', removed)).toBe(false);
  });

  it('bitmiş antrenman silme: cascade ile bütün ağaç silme kaydı olarak', async () => {
    const r = await routineWith(2);
    const s = await finishedSession(r.id);
    const keptSetIds = (await t.db.select({ id: sets.id }).from(sets)).map((x) => x.id);
    await t.db.delete(syncOutbox); // gönderilmiş say

    await t.db.delete(workoutSessions).where(eq(workoutSessions.id, s.sessionId));

    expect(outboxIds(t, 'workout_sessions')).toEqual([s.sessionId]);
    expect(outboxIds(t, 'session_exercises')).toEqual([...s.seIds].sort());
    expect(outboxIds(t, 'sets')).toEqual([...keptSetIds].sort());
  });

  it('susturma açıkken hiçbir şey kaydedilmiyor (geri yükleme, sıfırlama, çekme)', async () => {
    await t.db.transaction(async (tx) => {
      await withSyncSuppressed(tx, async () => {
        // Sunucudan çekilen satırların yazılması gibi: yankı yok (1.2)
        await tx.insert(routines).values({ id: 'remote-r', name: 'Uzak' });
        await tx
          .insert(routineExercises)
          .values({ id: 'remote-re', routineId: 'remote-r', exerciseId: exA, orderIndex: 0 });
        await tx.update(routines).set({ name: 'Uzak 2' }).where(eq(routines.id, 'remote-r'));
        await tx.delete(routines).where(eq(routines.id, 'remote-r'));
      });
    });
    expect(outbox(t)).toEqual([]);
    expect(await readSyncState(t.db)).toMatchObject({ tracking: true, suppress: false });

    // Susturma kalkınca takip devam ediyor
    await t.db.insert(routines).values({ id: 'local-r', name: 'Yerel' });
    expect(outboxIds(t, 'routines')).toEqual(['local-r']);
  });

  it('sıfırlama ve geri yükleme: giden kutusunda silme kaydı yok, tam tarama/çekme yeniden açılıyor', async () => {
    const r = await routineWith(2);
    await finishedSession(r.id);
    await t.db.update(syncState).set({ initialUploadDone: true, pullCursor: '2026-10-01T00:00:00Z' });
    const backup = await buildBackup(t.db);
    expect(outbox(t).length).toBeGreaterThan(0);

    await wipeUserData(t.db);
    expect(outbox(t)).toEqual([]);
    expect(await readSyncState(t.db)).toMatchObject({
      tracking: true,
      suppress: false,
      ownerUserId: null, // telefon boş: sahip bırakıldı
      initialUploadDone: false,
      pullCursor: null,
    });

    await t.db.update(syncState).set({ ownerUserId: 'u1', initialUploadDone: true, pullCursor: 'x' });
    await t.db.insert(routines).values({ id: 'not-in-backup', name: 'Yedekte yok' });
    await restoreBackup(t.db, backup);
    // Yedekte olmayan rutin yerelde gitti ama silme kaydı yok: bulutta kalır
    expect(rowExists(t, 'routines', 'not-in-backup')).toBe(false);
    expect(outbox(t)).toEqual([]);
    expect(await readSyncState(t.db)).toMatchObject({
      tracking: true,
      suppress: false,
      ownerUserId: 'u1',
      initialUploadDone: false,
      pullCursor: null,
    });
  });

  it('geri yükleme yarıda hata verirse susturma açık kalmıyor, veri değişmiyor', async () => {
    const r = await routineWith(1);
    const before = await buildBackup(t.db);
    const broken: BackupFile = {
      ...before,
      tables: {
        ...before.tables,
        // Var olmayan egzersize bağlı rutin egzersizi: FK hatası
        routineExercises: [
          { ...(before.tables.routineExercises[0] as object), exerciseId: 'yok' },
        ],
      },
    };
    await expect(restoreBackup(t.db, broken)).rejects.toThrow();
    expect(await readSyncState(t.db)).toMatchObject({ suppress: false, tracking: true });
    expect((await buildBackup(t.db)).tables).toEqual(before.tables);
    expect(rowExists(t, 'routines', r.id)).toBe(true);
  });
});

// ============================================================================
// Yarım antrenman (tasarım 1.4)
// ============================================================================

describe('yarım antrenman', () => {
  let t: TestDb;
  let routineId: string;
  beforeEach(async () => {
    t = open();
    await t.db.insert(exercises).values([
      { id: 'Barbell_Squat', name: 'Squat', primaryMuscles: '[]', category: 'strength' },
    ]);
    routineId = newId();
    await t.db.insert(routines).values({ id: routineId, name: 'Bacak' });
    await t.db.insert(routineExercises).values([
      { id: newId(), routineId, exerciseId: 'Barbell_Squat', orderIndex: 0, targetSets: 3 },
      { id: newId(), routineId, exerciseId: 'Barbell_Squat', orderIndex: 1, targetSets: 2 },
    ]);
  });

  const sessionTree = async (sessionId: string) => {
    const ses = await t.db
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, sessionId));
    const setRows = await t.db
      .select({ id: sets.id })
      .from(sets)
      .innerJoin(sessionExercises, eq(sessionExercises.id, sets.sessionExerciseId))
      .where(eq(sessionExercises.sessionId, sessionId));
    return { seIds: ses.map((s) => s.id), setIds: setRows.map((s) => s.id) };
  };

  it('antrenman sürerken satırları antrenman kimliğiyle bekliyor', async () => {
    await startTracking(t.db, 'u1');
    const s = (await createSessionFromRoutine(t.db, { id: routineId, name: 'Bacak' }))!;
    const { seIds, setIds } = await sessionTree(s);
    const tree = outbox(t).filter((e) => e.table_name !== 'routines' && e.table_name !== 'routine_exercises');
    expect(tree).toHaveLength(1 + seIds.length + setIds.length);
    expect(tree.every((e) => e.session_id === s)).toBe(true);
    // Motor: ended_at boşsa bu kayıtları atlar (tasarım madde 6)
    expect(
      await t.db.select().from(workoutSessions).where(and(eq(workoutSessions.id, s), isNull(workoutSessions.endedAt)))
    ).toHaveLength(1);
  });

  it('bitirince: tamamlanan setler gider, silinen boş setler hiç gönderilmez', async () => {
    await startTracking(t.db, 'u1');
    const s = (await createSessionFromRoutine(t.db, { id: routineId, name: 'Bacak' }))!;
    const { seIds, setIds } = await sessionTree(s);
    await t.db.update(sets).set({ isCompleted: true, reps: 5 }).where(eq(sets.id, setIds[0]));

    await finishSessionRecord(t.db, {
      sessionId: s,
      sessionExerciseIds: seIds,
      pendingFilledIds: [],
      mode: 'delete',
    });

    expect(outboxIds(t, 'sets')).toEqual([setIds[0]]);
    expect(outboxIds(t, 'session_exercises')).toEqual([...seIds].sort());
    expect(outboxIds(t, 'workout_sessions')).toEqual([s]);
  });

  it('vazgeçilen yarım antrenman: hiçbir kaydı kalmıyor', async () => {
    await startTracking(t.db, 'u1');
    const s = (await createSessionFromRoutine(t.db, { id: routineId, name: 'Bacak' }))!;
    const { setIds } = await sessionTree(s);
    await t.db.update(sets).set({ isCompleted: true, reps: 5 }).where(eq(sets.id, setIds[0]));

    await discardSession(t.db, s);

    expect(outbox(t).filter((e) => !e.table_name.startsWith('routine'))).toEqual([]);
  });

  it('takip, antrenman sürerken açılsa da vazgeçilince hiçbir şey kalmıyor', async () => {
    const s = (await createSessionFromRoutine(t.db, { id: routineId, name: 'Bacak' }))!;
    await startTracking(t.db, 'u1');
    expect(outbox(t).every((e) => e.session_id === s)).toBe(true);
    expect(outbox(t).length).toBeGreaterThan(0);

    await discardSession(t.db, s);
    expect(outbox(t)).toEqual([]);
  });

  it('boş yarım antrenman temizliği giden kutusuna bir şey bırakmıyor', async () => {
    await startTracking(t.db, 'u1');
    await t.db.insert(workoutSessions).values({
      id: newId(),
      name: 'Boş',
      startedAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
    });
    expect(await deleteStaleEmptySessions(t.db, Date.now())).toBe(1);
    expect(outbox(t).filter((e) => !e.table_name.startsWith('routine'))).toEqual([]);
  });

  it('takip açılırken mevcut geçmiş giden kutusuna yazılmıyor (ilk gönderim tarar)', async () => {
    const s = (await createSessionFromRoutine(t.db, { id: routineId, name: 'Bacak' }))!;
    const { seIds } = await sessionTree(s);
    await finishSessionRecord(t.db, {
      sessionId: s,
      sessionExerciseIds: seIds,
      pendingFilledIds: [],
      mode: 'delete',
    });

    await startTracking(t.db, 'u1');

    expect(outbox(t)).toEqual([]);
    expect(await readSyncState(t.db)).toMatchObject({ tracking: true, initialUploadDone: false });
  });
});

// ============================================================================
// Hazır egzersiz kimlikleri değişmez (tasarım madde 4)
// ============================================================================

describe('hazır egzersiz kimlikleri', () => {
  it('dondurulmuş listedeki her kimlik gömülü veride hâlâ var', () => {
    const frozen = JSON.parse(
      readFileSync(path.join(FIXTURES, 'seed-exercise-ids.json'), 'utf8')
    ) as string[];
    const current = new Set([
      ...(JSON.parse(readFileSync(path.join(ROOT, 'assets/seed/exercises.json'), 'utf8')) as {
        id: string;
      }[]).map((e) => e.id),
      ...(JSON.parse(readFileSync(path.join(ROOT, 'assets/seed/cardio-modes.json'), 'utf8')) as {
        id: string;
      }[]).map((e) => e.id),
    ]);
    const missing = frozen.filter((id) => !current.has(id));
    // Bu test kırılırsa: eşitlenmiş antrenmanlar bu kimliklere bağlı.
    // Kimlik silinmez / yeniden adlandırılmaz; yeni egzersiz yeni kimlikle eklenir.
    expect(missing).toEqual([]);
    expect(frozen.length).toBe(885);
  });
});
