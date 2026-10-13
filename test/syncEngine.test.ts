/**
 * Eşitleme motoru (v3.1b) — iki telefon (gerçek SQLite, migration'lar
 * uygulanmış) ve sözleşmeyi taklit eden sahte sunucu
 * (test/helpers/fakeSyncServer.ts; gerçek SQL ile aynı davrandığı
 * test/syncServer.test.ts'te denetleniyor).
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bodyMetrics,
  exercises,
  routineExercises,
  routines,
  sessionExercises,
  syncOutbox,
  syncState,
  workoutSessions,
} from '@/db/schema';
import { buildBackup, restoreBackup, validateBackup, wipeUserData, type BackupFile } from '@/lib/backup';
import { finishSessionRecord } from '@/lib/finishSession';
import { newId } from '@/lib/id';
import { saveSessionNote } from '@/lib/notes';
import {
  DELETE_CONFIRM_LIMIT,
  OWNER_MISMATCH_MESSAGE,
  UNKNOWN_EXERCISE_NAME,
  getSyncStatus,
  pullChanges,
} from '@/lib/sync/engine';
import { FOREGROUND_MIN_INTERVAL_MS, createTriggerClock, shouldRun, syncIfEnabled } from '@/lib/sync/runner';
import { readSyncState } from '@/lib/syncState';

import { FakeSyncServer } from './helpers/fakeSyncServer';
import { buildSyntheticYearBackup } from './helpers/syntheticBackup';
import {
  A,
  B,
  closePhones,
  expectOk,
  newRoutine,
  outboxCount,
  phone,
  shiftOutboxClock,
  sync,
  synced,
  withoutSessions,
  workout,
} from './helpers/syncPhones';

afterEach(closePhones);

// ============================================================================

describe('iki telefon', () => {
  it('A gönderir, B çeker: B\'de aynı veri; ölçüler gitmiyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db);
    await workout(a.db, r);
    await workout(a.db, r);
    await a.db.insert(bodyMetrics).values({ id: newId(), date: '2026-10-01', weightKg: 80 });

    await expectOk(sync(a, server));
    await expectOk(sync(b, server));

    expect(await synced(b.db)).toEqual(await synced(a.db));
    expect((await synced(b.db)).sets.length).toBeGreaterThan(0);
    expect(await b.db.select().from(bodyMetrics)).toEqual([]);
    expect(await outboxCount(b.db)).toBe(0); // yankı yok
  });

  it('düzenleme ve silme iki yönde yayılıyor (cascade dahil)', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r1 = await newRoutine(a.db, 'Bir');
    const r2 = await newRoutine(a.db, 'İki');
    const s1 = await workout(a.db, r1);
    await workout(a.db, r2);
    await expectOk(sync(a, server));
    await expectOk(sync(b, server));

    // B: not düzenle, rutin sil (antrenmanın bağı boşalır)
    await saveSessionNote(b.db, s1, 'B yazdı');
    await b.db.delete(routines).where(eq(routines.id, r2));
    await expectOk(sync(b, server));
    await expectOk(sync(a, server));
    expect(await synced(a.db)).toEqual(await synced(b.db));
    const [s1OnA] = await a.db.select().from(workoutSessions).where(eq(workoutSessions.id, s1));
    expect(s1OnA.notes).toBe('B yazdı');
    expect(await a.db.select().from(routines).where(eq(routines.id, r2))).toEqual([]);

    // A: antrenman sil → B'de hareketleri ve setleri de gidiyor
    await a.db.delete(workoutSessions).where(eq(workoutSessions.id, s1));
    await expectOk(sync(a, server));
    await expectOk(sync(b, server));
    expect(await synced(b.db)).toEqual(await synced(a.db));
    expect(await b.db.select().from(sessionExercises).where(eq(sessionExercises.sessionId, s1))).toEqual([]);
    expect(await outboxCount(a.db)).toBe(0);
    expect(await outboxCount(b.db)).toBe(0);
  });

  it('hazır egzersizi olmayan telefona yer tutucu egzersiz ekleniyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    await a.db.insert(exercises).values({ id: 'Yeni_Egzersiz', name: 'Yeni', primaryMuscles: '[]', category: 'strength' });
    const r = await a.db.insert(routines).values({ id: newId(), name: 'R' }).returning();
    await a.db
      .insert(routineExercises)
      .values({ id: newId(), routineId: r[0].id, exerciseId: 'Yeni_Egzersiz', orderIndex: 0 });
    await expectOk(sync(a, server));
    await expectOk(sync(b, server));
    const [ex] = await b.db.select().from(exercises).where(eq(exercises.id, 'Yeni_Egzersiz'));
    expect(ex).toMatchObject({ name: UNKNOWN_EXERCISE_NAME, isCustom: true });
    expect(await b.db.select().from(routineExercises)).toHaveLength(1);
  });
});

describe('çakışma', () => {
  it('aynı satırı iki telefon düzenlerse son yazan kazanıyor (gönderim sırasından bağımsız)', async () => {
    for (const order of ['eski-önce', 'yeni-önce'] as const) {
      const server = new FakeSyncServer();
      const a = await phone();
      const b = await phone();
      const r = await newRoutine(a.db);
      await expectOk(sync(a, server));
      await expectOk(sync(b, server));

      await a.db.update(routines).set({ name: 'A (eski)' }).where(eq(routines.id, r));
      await b.db.update(routines).set({ name: 'B (yeni)' }).where(eq(routines.id, r));
      await shiftOutboxClock(a.db, -60_000); // A'nın düzenlemesi bir dakika önce

      const [first, second] = order === 'eski-önce' ? [a, b] : [b, a];
      await expectOk(sync(first, server));
      await expectOk(sync(second, server));
      await expectOk(sync(first, server));

      for (const p of [a, b]) {
        const [row] = await p.db.select().from(routines).where(eq(routines.id, r));
        expect(row.name, order).toBe('B (yeni)');
      }
    }
  });

  it('telefonda gönderilmemiş değişikliği olan satır çekmede ezilmiyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db);
    await expectOk(sync(a, server));
    await expectOk(sync(b, server));

    await a.db.update(routines).set({ name: 'A' }).where(eq(routines.id, r));
    await expectOk(sync(a, server));
    // B'nin henüz gönderilmemiş düzenlemesi; yalnızca çekme
    await b.db.update(routines).set({ name: 'B bekliyor' }).where(eq(routines.id, r));
    const state = (await readSyncState(b.db))!;
    await pullChanges(b.db, server.transport(A), {
      cursor: state.pullCursor,
      confirmDeletes: false,
      now: () => new Date(),
    });
    const [row] = await b.db.select().from(routines).where(eq(routines.id, r));
    expect(row.name).toBe('B bekliyor');
    expect(await outboxCount(b.db)).toBe(1);
  });
});

describe('yarıda kesilme ve kilit', () => {
  it('gönderim yanıtı kaybolursa (sunucu uyguladı) tekrar: çoğalma yok', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    await expectOk(sync(a, server)); // ilk eşitleme (boş)
    const r = await newRoutine(a.db);
    await workout(a.db, r);

    server.failNext('push', 'after');
    const failed = await sync(a, server);
    expect(failed).toMatchObject({ status: 'error', issue: { errorKind: 'network' } });
    expect(await outboxCount(a.db)).toBeGreaterThan(0);
    expect((await getSyncStatus(a.db)).issue?.message).toMatch(/İnternet/);

    await expectOk(sync(a, server));
    expect(await outboxCount(a.db)).toBe(0);
    expect(server.rows(A, 'sets')).toHaveLength((await synced(a.db)).sets.length);
    expect((await getSyncStatus(a.db)).issue).toBeNull();
  });

  it('ilk gönderim yarıda kesilirse baştan taranıyor, kayıp ve çoğalma yok', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db);
    for (let i = 0; i < 3; i++) await workout(a.db, r);

    server.failNext('push', 'before', 2); // üçüncü parti (oturumlar) düşer
    expect(await sync(a, server)).toMatchObject({ status: 'error' });
    expect((await readSyncState(a.db))!.initialUploadDone).toBe(false);

    await expectOk(sync(a, server));
    await expectOk(sync(b, server));
    expect(await synced(b.db)).toEqual(await synced(a.db));
  });

  it('çekme yarıda kesilirse imleç ilerlemiyor; tekrar: eksiksiz', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db);
    await workout(a.db, r);
    await expectOk(sync(a, server));

    server.failNext('pull', 'before', 3); // dördüncü tablo
    expect(await sync(b, server)).toMatchObject({ status: 'error' });
    expect((await readSyncState(b.db))!.pullCursor).toBeNull();
    expect(await b.db.select().from(routines)).toEqual([]); // yarım uygulanmadı

    await expectOk(sync(b, server));
    expect(await synced(b.db)).toEqual(await synced(a.db));
  });

  it('aynı anda iki eşitleme çalışmıyor (kilit)', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const p1 = sync(a, server);
    const p2 = sync(a, server);
    expect(p2).toBe(p1);
    await p1;
    expect(server.calls.filter((c) => c.op === 'serverTime')).toHaveLength(1);
  });
});

describe('yarım antrenman', () => {
  it('sürerken gönderilmiyor; bitince hepsi birlikte gidiyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db);
    await expectOk(sync(a, server));

    const s = await workout(a.db, r, false);
    await expectOk(sync(a, server));
    expect(server.rows(A, 'workout_sessions')).toEqual([]);
    expect(server.rows(A, 'sets')).toEqual([]);
    expect(await outboxCount(a.db)).toBeGreaterThan(0);

    const ses = await a.db.select().from(sessionExercises).where(eq(sessionExercises.sessionId, s));
    await finishSessionRecord(a.db, {
      sessionId: s,
      sessionExerciseIds: ses.map((x) => x.id),
      pendingFilledIds: [],
      mode: 'delete',
    });
    await expectOk(sync(a, server));
    expect(server.rows(A, 'workout_sessions')).toHaveLength(1);
    expect(await outboxCount(a.db)).toBe(0);
    await expectOk(sync(b, server));
    expect(await synced(b.db)).toEqual(await synced(a.db));
  });

  it('ilk eşitlemede yarım antrenman taranmıyor; vazgeçilince hiç gitmiyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const r = await newRoutine(a.db);
    const s = await workout(a.db, r, false);
    await expectOk(sync(a, server));
    expect(server.rows(A, 'workout_sessions')).toEqual([]);

    await a.db.delete(workoutSessions).where(eq(workoutSessions.id, s));
    await expectOk(sync(a, server));
    expect(server.stored(A, 'workout_sessions', s)).toBeUndefined();
    expect(await outboxCount(a.db)).toBe(0);
  });
});

describe('silme korumaları', () => {
  async function phoneWithSessions(server: FakeSyncServer, n: number) {
    const a = await phone();
    const r = await newRoutine(a.db, 'R', 1);
    for (let i = 0; i < n; i++) {
      await a.db.insert(workoutSessions).values({
        id: newId(),
        routineId: r,
        name: `A${i}`,
        startedAt: '2026-01-01T10:00:00.000Z',
        endedAt: '2026-01-01T11:00:00.000Z',
      });
    }
    await expectOk(sync(a, server));
    return a;
  }

  it(`gönderme: ${DELETE_CONFIRM_LIMIT + 1} antrenman silindiyse hiçbir şey gitmiyor, onay bekleniyor`, async () => {
    const server = new FakeSyncServer();
    const a = await phoneWithSessions(server, DELETE_CONFIRM_LIMIT + 1);
    await a.db.delete(workoutSessions);
    const callsBefore = server.calls.length;

    const r = await sync(a, server);
    expect(r).toMatchObject({ status: 'blocked', issue: { kind: 'needs_confirmation', direction: 'push', deletes: 51 } });
    expect(server.calls.length).toBe(callsBefore); // hiç istek yok
    expect(server.rows(A, 'workout_sessions')).toHaveLength(51);
    expect((await getSyncStatus(a.db)).issue).toMatchObject({ kind: 'needs_confirmation' });

    // Onaylanınca gidiyor
    await expectOk(sync(a, server, A, true));
    expect(server.rows(A, 'workout_sessions')).toHaveLength(0);
  });

  it(`çekme: buluttan ${DELETE_CONFIRM_LIMIT + 1} silme gelirse hiçbir şey uygulanmıyor`, async () => {
    const server = new FakeSyncServer();
    const a = await phoneWithSessions(server, DELETE_CONFIRM_LIMIT + 1);
    const b = await phone();
    await expectOk(sync(b, server));
    const cursorBefore = (await readSyncState(b.db))!.pullCursor;
    await a.db.delete(workoutSessions);
    await expectOk(sync(a, server, A, true));

    // Aynı çekmedeki başka bir değişiklik de uygulanmamalı
    await a.db.update(routines).set({ name: 'Yeni ad' });
    await expectOk(sync(a, server, A, true));

    const r = await sync(b, server);
    expect(r).toMatchObject({ status: 'blocked', issue: { kind: 'needs_confirmation', direction: 'pull', deletes: 51 } });
    expect(await b.db.select().from(workoutSessions)).toHaveLength(51);
    expect((await b.db.select().from(routines))[0].name).toBe('R');
    expect((await readSyncState(b.db))!.pullCursor).toBe(cursorBefore);

    await expectOk(sync(b, server, A, true));
    expect(await b.db.select().from(workoutSessions)).toHaveLength(0);
  });

  it(`${DELETE_CONFIRM_LIMIT} silme sınırın içinde`, async () => {
    const server = new FakeSyncServer();
    const a = await phoneWithSessions(server, DELETE_CONFIRM_LIMIT);
    await a.db.delete(workoutSessions);
    await expectOk(sync(a, server));
  });
});

describe('hesap', () => {
  it('telefondaki veri başka hesabınsa hiçbir istek yok, durum "hesap uyuşmuyor"', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    await newRoutine(a.db);
    await expectOk(sync(a, server, A));

    const r = await sync(a, server, B);
    expect(r).toEqual({ status: 'blocked', issue: { kind: 'owner_mismatch', message: OWNER_MISMATCH_MESSAGE } });
    expect(server.calls.filter((c) => c.userId === B)).toEqual([]);
    expect((await getSyncStatus(a.db)).issue?.kind).toBe('owner_mismatch');
    expect(server.rows(B, 'routines')).toEqual([]);
  });

  it('sıfırlamadan sonra telefon boş: giren hesap verisini geri indiriyor, bulut silinmiyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const r = await newRoutine(a.db);
    await workout(a.db, r);
    await expectOk(sync(a, server));
    const before = await synced(a.db);

    await wipeUserData(a.db);
    await expectOk(sync(a, server));
    expect(await synced(a.db)).toEqual(before);
  });

  it('eski yedek geri yüklenince bulutla birleşiyor; buluttaki yeni düzenleme ezilmiyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const r = await newRoutine(a.db, 'Eski ad');
    await expectOk(sync(a, server));
    const oldBackup = await buildBackup(a.db);

    await a.db.update(routines).set({ name: 'Yeni ad' }).where(eq(routines.id, r));
    const r2 = await newRoutine(a.db, 'Yedekten sonra');
    await expectOk(sync(a, server));

    await restoreBackup(a.db, oldBackup);
    await expectOk(sync(a, server));
    const names = (await a.db.select().from(routines)).map((x) => x.name).sort();
    expect(names).toEqual(['Yedekten sonra', 'Yeni ad']);
    expect(server.rows(A, 'routines').map((x) => x.name).sort()).toEqual(['Yedekten sonra', 'Yeni ad']);
    expect(r2).toBeTruthy();
  });
});

describe('telefon saati', () => {
  it('bir gün ileri saatli telefon satırı kilitleyemiyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db);
    await expectOk(sync(a, server));
    await expectOk(sync(b, server, A));

    await a.db.update(routines).set({ name: 'İleri saatli A' }).where(eq(routines.id, r));
    await shiftOutboxClock(a.db, 24 * 3600_000);
    await expectOk(sync(a, server));

    server.advance(10 * 60_000);
    await b.db.update(routines).set({ name: '10 dk sonra B' }).where(eq(routines.id, r));
    await shiftOutboxClock(b.db, 10 * 60_000);
    await expectOk(sync(b, server, A));
    await expectOk(sync(a, server));
    for (const p of [a, b]) {
      expect((await p.db.select().from(routines).where(eq(routines.id, r)))[0].name).toBe('10 dk sonra B');
    }
  });

  it('bir gün geri saatli telefonun yeni antrenmanı öbür telefona yine iniyor (imleç sunucu saatinde)', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db);
    await expectOk(sync(a, server));
    await expectOk(sync(b, server, A));

    server.advance(60_000);
    const s = await workout(a.db, r);
    await shiftOutboxClock(a.db, -24 * 3600_000);
    await expectOk(sync(a, server));
    server.advance(60_000);
    await expectOk(sync(b, server, A));
    expect(await b.db.select().from(workoutSessions).where(eq(workoutSessions.id, s))).toHaveLength(1);
    expect(await synced(b.db)).toEqual(await synced(a.db));
  });
});

describe('bayrak ve tetikleyiciler', () => {
  it('bayrak kapalıyken motor hiç çalışmıyor: istemci kurulmuyor, takip açılmıyor', async () => {
    const a = await phone();
    const makeTransport = vi.fn(() => new FakeSyncServer().transport(A));
    await newRoutine(a.db);

    expect(await syncIfEnabled({ enabled: false, userId: A, db: a.db, makeTransport })).toEqual({
      status: 'disabled',
    });
    expect(await syncIfEnabled({ enabled: true, userId: null, db: a.db, makeTransport })).toEqual({
      status: 'disabled',
    });
    expect(makeTransport).not.toHaveBeenCalled();
    expect(await readSyncState(a.db)).toMatchObject({ tracking: false, ownerUserId: null });
    expect(await outboxCount(a.db)).toBe(0);
  });

  it('bayrak açık + giriş yapılmış: eşitleniyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    await newRoutine(a.db);
    const r = await syncIfEnabled({ enabled: true, userId: A, db: a.db, makeTransport: () => server.transport(A) });
    expect(r).toMatchObject({ status: 'ok' });
    expect(server.rows(A, 'routines')).toHaveLength(1);
  });

  it('öne gelme en fazla 5 dakikada bir; diğer tetikler kısıtsız', () => {
    expect(shouldRun('foreground', null, 0)).toBe(true);
    expect(shouldRun('foreground', 0, FOREGROUND_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(shouldRun('foreground', 0, FOREGROUND_MIN_INTERVAL_MS)).toBe(true);
    for (const t of ['login', 'workout_finished', 'manual'] as const) {
      expect(shouldRun(t, 0, 1)).toBe(true);
    }
    const clock = createTriggerClock();
    expect(clock.take('login', 1000)).toBe(true);
    expect(clock.take('foreground', 2000)).toBe(false); // girişten hemen sonra öne gelme
    expect(clock.take('workout_finished', 3000)).toBe(true);
    expect(clock.take('foreground', 3000 + FOREGROUND_MIN_INTERVAL_MS)).toBe(true);
  });
});

describe('durum', () => {
  it('son eşitleme, bekleyen kayıt, son hata', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    expect(await getSyncStatus(a.db)).toMatchObject({ tracking: false, pending: 0, lastSyncAt: null, issue: null });

    await expectOk(sync(a, server));
    await newRoutine(a.db, 'R', 2);
    const status = await getSyncStatus(a.db);
    expect(status).toMatchObject({ tracking: true, ownerUserId: A, initialUploadDone: true, pending: 3 });
    expect(status.lastSyncAt).not.toBeNull();

    await expectOk(sync(a, server));
    expect((await getSyncStatus(a.db)).pending).toBe(0);
    expect(await a.db.select().from(syncState)).toHaveLength(1);
  });
});

describe('gerçek ve bir yıllık veriyle uçtan uca', () => {
  const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
  const real = (() => {
    try {
      return readdirSync(FIXTURES).filter((f) => f.endsWith('.local.json'));
    } catch {
      return [];
    }
  })();

  async function roundTrip(data: BackupFile) {
    const server = new FakeSyncServer();
    const a = await phone();
    await restoreBackup(a.db, data);
    await expectOk(sync(a, server));
    // Kalan kayıtlar yalnızca bitmemiş antrenmanın ağacı (bekliyor)
    const open = new Set(
      (await a.db.select().from(workoutSessions)).filter((s) => s.endedAt == null).map((s) => s.id)
    );
    const left = await a.db.select().from(syncOutbox);
    expect(left.every((e) => e.sessionId != null && open.has(e.sessionId))).toBe(true);
    expect(left.length > 0).toBe(open.size > 0);

    const b = await phone();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expectOk(sync(b, server));
    const skipped = warn.mock.calls.filter((c) => String(c[0]).includes('ebeveyni yok'));
    warn.mockRestore();
    expect(skipped).toEqual([]);
    expect(await synced(b.db)).toEqual(withoutSessions(await synced(a.db), open));
    expect(await outboxCount(b.db)).toBe(0);
    return { a, b, server };
  }

  it('sentetik bir yıllık kullanıcı: A → bulut → boş B', async () => {
    const data = buildSyntheticYearBackup();
    const { b } = await roundTrip(data);
    expect((await synced(b.db)).sets).toHaveLength(4800);
  }, 60_000);

  it.skipIf(real.length === 0)(`gerçek yedek: ${real.join(', ') || 'yok, atlandı'}`, async () => {
    for (const file of real) {
      const result = validateBackup(readFileSync(path.join(FIXTURES, file), 'utf8'));
      if (!result.ok) throw new Error(`${file}: ${result.error}`);
      const finished = (result.data.tables.workoutSessions as { endedAt: string | null }[]).filter(
        (s) => s.endedAt != null
      ).length;
      const { b } = await roundTrip(result.data);
      expect(await b.db.select().from(workoutSessions)).toHaveLength(finished);
    }
  }, 120_000);
});
