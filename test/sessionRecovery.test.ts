/**
 * Yarım kalan antrenmanı kurtarma — karar (saf), sorgu (gerçek SQLite)
 * ve dinlenme sayacının kv-store'a yazılması (gerçek store).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { cardioSegments, sessionExercises, sets, workoutSessions } from '@/db/schema';
import {
  ASK_MAX_MS,
  SAVED_REST_TIMER_KEY,
  SILENT_RESUME_MAX_MS,
  canFinishOpenSession,
  connectRestTimerPersistence,
  decideSessionRecovery,
  deleteStaleEmptySessions,
  discardSession,
  findOpenSessions,
  isDisposableEmptySession,
  lastActivityMs,
  parseSavedRestTimer,
  recoveryEndedAt,
  restorableRestTimer,
  type OpenSession,
} from '@/lib/sessionRecovery';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import {
  countRows,
  createCompletedSession,
  createSession,
  createTestDb,
  seedExercise,
  type TestDb,
} from './helpers/testDb';

const NOW = new Date('2026-10-08T18:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function open(id: string, startedAgoMs: number, lastSetAgoMs?: number): OpenSession {
  return {
    id,
    name: `Antrenman ${id}`,
    startedAt: new Date(NOW - startedAgoMs).toISOString(),
    lastSetAt: lastSetAgoMs == null ? null : new Date(NOW - lastSetAgoMs).toISOString(),
    completedSetCount: lastSetAgoMs == null ? 0 : 1,
  };
}

function decide(openSessions: OpenSession[], activeSessionId: string | null = null) {
  return decideSessionRecovery({ activeSessionId, openSessions, nowMs: NOW });
}

// ============================================================================
// Karar
// ============================================================================

describe('decideSessionRecovery', () => {
  it('store\'da aktif seans varsa dokunulmuyor', () => {
    expect(decide([open('a', HOUR)], 'x')).toEqual({ kind: 'none' });
  });

  it('yarım seans yoksa bir şey yapılmıyor', () => {
    expect(decide([])).toEqual({ kind: 'none' });
  });

  it('12 saatten yeni: sessizce geri yükleniyor', () => {
    expect(decide([open('a', HOUR)])).toEqual({ kind: 'resume', sessionId: 'a' });
  });

  it('sınır: 12 saatin 1 ms altı sessiz, tam 12 saat soruluyor', () => {
    expect(decide([open('a', SILENT_RESUME_MAX_MS - 1)]).kind).toBe('resume');
    const exact = open('a', SILENT_RESUME_MAX_MS);
    expect(decide([exact])).toEqual({ kind: 'ask', session: exact });
  });

  it('12 saat – 3 gün arası: soruluyor', () => {
    const old = open('a', 30 * HOUR);
    expect(decide([old])).toEqual({ kind: 'ask', session: old });
    const almost = open('a', ASK_MAX_MS - 1);
    expect(decide([almost])).toEqual({ kind: 'ask', session: almost });
  });

  it('3 gün ve daha eski: soru yok (yalnızca Ayarlar\'da)', () => {
    expect(decide([open('a', ASK_MAX_MS)])).toEqual({ kind: 'none' });
    // Yedekle gelen haftalar önceki yarım seans
    expect(decide([open('a', 40 * DAY, 40 * DAY)])).toEqual({ kind: 'none' });
  });

  it('yaş son tamamlanan setten ölçülüyor: uzun antrenman eski sayılmıyor', () => {
    // 13 saat önce başlamış, son set 1 saat önce
    expect(decide([open('a', 13 * HOUR, HOUR)])).toEqual({ kind: 'resume', sessionId: 'a' });
    // 4 gün önce başlamış, son set 2 gün önce: soruluyor
    expect(decide([open('a', 4 * DAY, 2 * DAY)]).kind).toBe('ask');
  });

  it('birden fazla yarım seans: yalnızca en yenisi', () => {
    expect(
      decide([open('eski', 72 * HOUR), open('yeni', 2 * HOUR), open('orta', 20 * HOUR)])
    ).toEqual({ kind: 'resume', sessionId: 'yeni' });

    const decision = decide([open('eski', 60 * HOUR), open('orta', 20 * HOUR)]);
    expect(decision.kind === 'ask' && decision.session.id).toBe('orta');

    // En yenisi 3 günden eskiyse hiçbiri için soru yok
    expect(decide([open('a', 5 * DAY), open('b', 10 * DAY)])).toEqual({ kind: 'none' });
  });

  it('saat geri alındıysa (başlangıç gelecekte) yeni sayılıyor', () => {
    expect(decide([open('a', -2 * HOUR)])).toEqual({ kind: 'resume', sessionId: 'a' });
  });

  it('zamanı okunamayan seans için soru yok', () => {
    const broken: OpenSession = {
      id: 'a',
      name: 'X',
      startedAt: 'bozuk',
      lastSetAt: null,
      completedSetCount: 0,
    };
    expect(decide([broken])).toEqual({ kind: 'none' });
  });
});

describe('lastActivityMs', () => {
  it('başlangıç ile son setin büyüğü; biri okunamazsa diğeri', () => {
    const base = { id: 'a', name: 'X', completedSetCount: 1 };
    expect(lastActivityMs(open('a', 3 * HOUR, HOUR))).toBe(NOW - HOUR);
    expect(lastActivityMs(open('a', 3 * HOUR))).toBe(NOW - 3 * HOUR);
    expect(
      lastActivityMs({ ...base, startedAt: 'bozuk', lastSetAt: new Date(NOW).toISOString() })
    ).toBe(NOW);
    expect(lastActivityMs({ ...base, startedAt: 'bozuk', lastSetAt: null })).toBeNull();
  });
});

describe('canFinishOpenSession / recoveryEndedAt', () => {
  it('tamamlanmış seti olmayan seans bitirilmiyor (silme öneriliyor)', () => {
    expect(canFinishOpenSession(open('a', 20 * HOUR))).toBe(false);
    expect(canFinishOpenSession(open('a', 20 * HOUR, 19 * HOUR))).toBe(true);
  });

  it('bitiş son tamamlanan set; set zamanı yoksa başlangıç', () => {
    const s = open('a', 20 * HOUR, 19 * HOUR);
    expect(recoveryEndedAt(s)).toBe(s.lastSetAt);
    const noTime = { ...open('a', 20 * HOUR), completedSetCount: 2 };
    expect(recoveryEndedAt(noTime)).toBe(noTime.startedAt);
  });
});

describe('isDisposableEmptySession', () => {
  const at = (agoMs: number) => new Date(NOW - agoMs).toISOString();

  it('notsuz ve 12 saatten eski: silinebilir', () => {
    expect(isDisposableEmptySession({ id: 'a', startedAt: at(SILENT_RESUME_MAX_MS), notes: null }, NOW)).toBe(true);
    expect(isDisposableEmptySession({ id: 'a', startedAt: at(30 * DAY), notes: '   ' }, NOW)).toBe(true);
  });

  it('12 saatten yeni, notlu, zamanı okunamayan ya da gelecekteki: silinmez', () => {
    expect(isDisposableEmptySession({ id: 'a', startedAt: at(SILENT_RESUME_MAX_MS - 1), notes: null }, NOW)).toBe(false);
    expect(isDisposableEmptySession({ id: 'a', startedAt: at(30 * DAY), notes: 'Diz ağrıdı' }, NOW)).toBe(false);
    expect(isDisposableEmptySession({ id: 'a', startedAt: 'bozuk', notes: null }, NOW)).toBe(false);
    expect(isDisposableEmptySession({ id: 'a', startedAt: at(-DAY), notes: null }, NOW)).toBe(false);
  });
});


// ============================================================================
// Sorgular — gerçek SQLite
// ============================================================================

describe('findOpenSessions / discardSession', () => {
  let t: TestDb;
  let db: Db;

  beforeEach(() => {
    t = createTestDb();
    db = t.db;
  });

  afterEach(() => t.close());

  it('yalnızca bitmemiş seanslar; son tamamlanan setin zamanı geliyor', async () => {
    const exerciseId = await seedExercise(db);
    await createCompletedSession(db, { exerciseId, startedAt: '2026-10-01T10:00:00.000Z' });
    const openOne = await createSession(db, {
      exerciseId,
      startedAt: '2026-10-08T10:00:00.000Z',
      setSeeds: [{ isCompleted: true }, { isCompleted: true }, { isCompleted: false }],
    });
    await db
      .update(sets)
      .set({ completedAt: '2026-10-08T10:20:00.000Z' })
      .where(eq(sets.id, openOne.setIds[0]!));
    await db
      .update(sets)
      .set({ completedAt: '2026-10-08T10:40:00.000Z' })
      .where(eq(sets.id, openOne.setIds[1]!));
    // Onaylanmamış setin zamanı sayılmıyor
    await db
      .update(sets)
      .set({ completedAt: '2026-10-08T11:30:00.000Z' })
      .where(eq(sets.id, openOne.setIds[2]!));

    expect(await findOpenSessions(db)).toEqual([
      {
        id: openOne.sessionId,
        name: 'Antrenman',
        startedAt: '2026-10-08T10:00:00.000Z',
        lastSetAt: '2026-10-08T10:40:00.000Z',
        completedSetCount: 2,
      },
    ]);
  });

  it('hiç set tamamlanmamış seans: lastSetAt null; birden çok hareket tek satır', async () => {
    const a = await seedExercise(db, { name: 'A' });
    const b = await seedExercise(db, { name: 'B' });
    const { sessionId } = await createSession(db, {
      exerciseId: a,
      startedAt: '2026-10-08T10:00:00.000Z',
      setSeeds: [{ isCompleted: false }],
    });
    await db.insert(sessionExercises).values({
      id: 'se-ikinci',
      sessionId,
      exerciseId: b,
      orderIndex: 1,
    });

    const rows = await findOpenSessions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: sessionId, lastSetAt: null, completedSetCount: 0 });
  });

  it('hareketsiz yarım seans kurtarılmıyor (aktif ekranda bitirilemezdi)', async () => {
    await db.insert(workoutSessions).values({
      id: 'bos',
      name: 'Boş',
      startedAt: '2026-10-08T10:00:00.000Z',
    });
    expect(await findOpenSessions(db)).toEqual([]);
  });

  it('birden çok yarım seansın hepsi dönüyor (yeni başlangıç önde); karar en yenisini seçiyor', async () => {
    const exerciseId = await seedExercise(db);
    const older = await createSession(db, { exerciseId, startedAt: '2026-10-05T10:00:00.000Z' });
    const newer = await createSession(db, { exerciseId, startedAt: '2026-10-08T17:00:00.000Z' });

    const rows = await findOpenSessions(db);
    expect(rows.map((r) => r.id)).toEqual([newer.sessionId, older.sessionId]);
    expect(
      decideSessionRecovery({ activeSessionId: null, openSessions: rows, nowMs: NOW })
    ).toEqual({ kind: 'resume', sessionId: newer.sessionId });
  });

  it('discardSession seansı, hareketlerini ve setlerini siliyor; diğerlerine dokunmuyor', async () => {
    const exerciseId = await seedExercise(db);
    const keep = await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-10-01T10:00:00.000Z',
      setSeeds: [{}],
    });
    const drop = await createSession(db, {
      exerciseId,
      startedAt: '2026-10-08T10:00:00.000Z',
      setSeeds: [{}, {}],
    });

    await discardSession(db, drop.sessionId);

    expect(await countRows(db, workoutSessions)).toBe(1);
    expect(await countRows(db, sessionExercises)).toBe(1);
    expect(await countRows(db, sets)).toBe(1);
    const left = await db.select({ id: workoutSessions.id }).from(workoutSessions);
    expect(left[0]!.id).toBe(keep.sessionId);
  });
});

describe('deleteStaleEmptySessions', () => {
  let t: TestDb;
  let db: Db;

  beforeEach(() => {
    t = createTestDb();
    db = t.db;
  });

  afterEach(() => t.close());

  const at = (agoMs: number) => new Date(NOW - agoMs).toISOString();

  async function emptySession(
    id: string,
    startedAgoMs: number,
    extra: { notes?: string; endedAt?: string } = {}
  ) {
    await db.insert(workoutSessions).values({
      id,
      name: 'Boş',
      startedAt: at(startedAgoMs),
      notes: extra.notes ?? null,
      endedAt: extra.endedAt ?? null,
    });
  }

  async function remainingIds() {
    const rows = await db.select({ id: workoutSessions.id }).from(workoutSessions);
    return rows.map((r) => r.id).sort();
  }

  it('yalnızca hareketsiz, kardiyosuz, notsuz, 12 saatten eski yarım seanslar siliniyor', async () => {
    const exerciseId = await seedExercise(db);

    await emptySession('sil-1', 2 * DAY);
    await emptySession('sil-2', 30 * DAY, { notes: '  ' });
    await emptySession('yeni', HOUR);
    await emptySession('notlu', 2 * DAY, { notes: 'Salon kapalıydı' });
    await emptySession('bitmis', 2 * DAY, { endedAt: at(2 * DAY - HOUR) });
    await emptySession('kardiyo', 2 * DAY);
    await db.insert(cardioSegments).values({
      id: 'cs-1',
      sessionId: 'kardiyo',
      exerciseId,
      orderIndex: 0,
      durationSeconds: 600,
    });
    // Hareketi olan yarım seans: kullanıcı verisi
    const withExercise = await createSession(db, { exerciseId, startedAt: at(10 * DAY) });

    expect(await deleteStaleEmptySessions(db, NOW)).toBe(2);
    expect(await remainingIds()).toEqual(
      ['bitmis', 'kardiyo', 'notlu', 'yeni', withExercise.sessionId].sort()
    );

    // İkinci çalıştırmada silinecek bir şey yok
    expect(await deleteStaleEmptySessions(db, NOW)).toBe(0);
  });

  it('aktif seans silinmiyor', async () => {
    await emptySession('aktif', 2 * DAY);
    expect(await deleteStaleEmptySessions(db, NOW, 'aktif')).toBe(0);
    expect(await remainingIds()).toEqual(['aktif']);
  });
});

// ============================================================================
// Dinlenme sayacı
// ============================================================================

describe('parseSavedRestTimer / restorableRestTimer', () => {
  const saved = { sessionId: 's1', startedAt: NOW - 30_000, durationSeconds: 90 };

  it('geçerli kayıt okunuyor, bozuk kayıt null', () => {
    expect(parseSavedRestTimer(JSON.stringify(saved))).toEqual(saved);
    expect(parseSavedRestTimer(null)).toBeNull();
    expect(parseSavedRestTimer('{bozuk')).toBeNull();
    expect(parseSavedRestTimer('null')).toBeNull();
    expect(parseSavedRestTimer(JSON.stringify({ ...saved, startedAt: '1' }))).toBeNull();
    expect(parseSavedRestTimer(JSON.stringify({ ...saved, durationSeconds: 0 }))).toBeNull();
  });

  it('aynı seansın süren sayacı geri geliyor', () => {
    expect(restorableRestTimer(saved, 's1', NOW)).toEqual({
      startedAt: saved.startedAt,
      durationSeconds: 90,
    });
  });

  it('başka seansın, bitmiş ya da son saniyesindeki sayaç gelmiyor', () => {
    expect(restorableRestTimer(saved, 's2', NOW)).toBeNull();
    expect(restorableRestTimer(saved, 's1', NOW + 60_000)).toBeNull();
    expect(restorableRestTimer(saved, 's1', NOW + 59_500)).toBeNull();
    expect(restorableRestTimer(null, 's1', NOW)).toBeNull();
    // Gelecekte başlamış sayaç (saat değişti) güvenilmez
    expect(restorableRestTimer({ ...saved, startedAt: NOW + 5000 }, 's1', NOW)).toBeNull();
  });
});

describe('connectRestTimerPersistence', () => {
  const store = () => useActiveWorkoutStore.getState();

  function memoryKv() {
    const data = new Map<string, string>();
    return {
      data,
      async getItem(key: string) {
        return data.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        data.set(key, value);
      },
      async removeItem(key: string) {
        data.delete(key);
      },
    };
  }

  /** Sıradaki yazmalar bitsin */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  let disconnect: (() => void) | null = null;

  afterEach(() => {
    disconnect?.();
    disconnect = null;
    store().endSession();
  });

  it('sayaç başlayınca yazılıyor, +/- ile güncelleniyor, durunca siliniyor', async () => {
    const kv = memoryKv();
    disconnect = connectRestTimerPersistence(useActiveWorkoutStore, kv);

    store().startSession('s1');
    store().startRestTimer(90);
    await flush();
    const first = parseSavedRestTimer(kv.data.get(SAVED_REST_TIMER_KEY) ?? null);
    expect(first).toMatchObject({ sessionId: 's1', durationSeconds: 90 });
    expect(first!.startedAt).toBe(store().restTimer!.startedAt);

    store().adjustRestTimer(15);
    await flush();
    expect(parseSavedRestTimer(kv.data.get(SAVED_REST_TIMER_KEY) ?? null)).toMatchObject({
      durationSeconds: 105,
    });

    store().stopRestTimer();
    await flush();
    expect(kv.data.has(SAVED_REST_TIMER_KEY)).toBe(false);
  });

  it('antrenman bitince kayıt siliniyor; art arda değişimde son değer kalıyor', async () => {
    const kv = memoryKv();
    disconnect = connectRestTimerPersistence(useActiveWorkoutStore, kv);

    store().startSession('s1');
    store().startRestTimer(60);
    store().stopRestTimer();
    store().startRestTimer(120);
    await flush();
    expect(parseSavedRestTimer(kv.data.get(SAVED_REST_TIMER_KEY) ?? null)).toMatchObject({
      durationSeconds: 120,
    });

    store().endSession();
    await flush();
    expect(kv.data.has(SAVED_REST_TIMER_KEY)).toBe(false);
  });

  it('yazma hatası onError\'a gidiyor, sonraki yazmalar sürüyor', async () => {
    const kv = memoryKv();
    const errors: unknown[] = [];
    let fail = true;
    const flaky = {
      ...kv,
      async setItem(key: string, value: string) {
        if (fail) {
          fail = false;
          throw new Error('disk dolu');
        }
        await kv.setItem(key, value);
      },
    };
    disconnect = connectRestTimerPersistence(useActiveWorkoutStore, flaky, (e) => errors.push(e));

    store().startSession('s1');
    store().startRestTimer(60);
    store().adjustRestTimer(15);
    await flush();
    expect(errors).toHaveLength(1);
    expect(parseSavedRestTimer(kv.data.get(SAVED_REST_TIMER_KEY) ?? null)).toMatchObject({
      durationSeconds: 75,
    });
  });
});
