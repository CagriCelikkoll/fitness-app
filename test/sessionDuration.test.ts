/**
 * Antrenman süresi (`sessionDuration.ts`): unutulup saatler sonra bitirilen
 * seans İlerleme'de, geçmişte, özette süreyi şişirmesin. Saf kural ile SQL
 * karşılığı aynı sonucu vermeli; gerçek SQLite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { cardioSegments, sets, workoutSessions } from '@/db/schema';
import { finishSessionRecord } from '@/lib/finishSession';
import { loadProgressData, progressStats } from '@/lib/progressStats';
import {
  FINISH_GRACE_SECONDS,
  MAX_SESSION_SECONDS,
  effectiveDurationSeconds,
  effectiveDurationSql,
} from '@/lib/sessionDuration';
import { loadWorkoutSummary } from '@/lib/workoutSummary';
import { createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

const START = '2026-10-08T10:00:00.000Z';
const at = (min: number) => new Date(new Date(START).getTime() + min * 60_000).toISOString();

describe('effectiveDurationSeconds (saf)', () => {
  it('normal antrenman olduğu gibi', () => {
    expect(effectiveDurationSeconds({ startedAt: START, durationSeconds: 3900, lastSetAt: at(60) })).toBe(3900);
  });

  it('kayıtlı süre yoksa null', () => {
    expect(effectiveDurationSeconds({ startedAt: START, durationSeconds: null, lastSetAt: at(60) })).toBeNull();
  });

  it('son setten saatler sonra bitirilen: son set + 10 dk', () => {
    // 60. dakikada son set, 23 saat sonra "Bitir"
    expect(effectiveDurationSeconds({ startedAt: START, durationSeconds: 23 * 3600, lastSetAt: at(60) })).toBe(
      3600 + FINISH_GRACE_SECONDS
    );
  });

  it('kardiyo süresi son sete eklenir', () => {
    expect(
      effectiveDurationSeconds({ startedAt: START, durationSeconds: 5 * 3600, lastSetAt: at(30), cardioSeconds: 1200 })
    ).toBe(1800 + FINISH_GRACE_SECONDS + 1200);
  });

  it('set zamanı yoksa (eski veri) en fazla 4 saat', () => {
    expect(effectiveDurationSeconds({ startedAt: START, durationSeconds: 40 * 3600, lastSetAt: null })).toBe(
      MAX_SESSION_SECONDS
    );
  });

  it('set zamanları uzun ama gerçek: yine en fazla 4 saat', () => {
    expect(effectiveDurationSeconds({ startedAt: START, durationSeconds: 10 * 3600, lastSetAt: at(9 * 60) })).toBe(
      MAX_SESSION_SECONDS
    );
  });

  it('saat geri alınmış (son set başlangıçtan önce): set kuralı yok sayılır', () => {
    expect(effectiveDurationSeconds({ startedAt: START, durationSeconds: 3000, lastSetAt: at(-30) })).toBe(3000);
  });

  it('negatif olmaz', () => {
    expect(effectiveDurationSeconds({ startedAt: START, durationSeconds: -50, lastSetAt: null })).toBe(0);
  });
});

describe('gerçek SQLite', () => {
  let t: TestDb;
  let db: Db;
  let exerciseId: string;

  beforeEach(async () => {
    t = createTestDb();
    db = t.db;
    exerciseId = await seedExercise(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    t.close();
  });

  /** Bitmiş seans: kayıtlı süre ve setlerin tamamlanma dakikaları */
  async function finished(durationSeconds: number | null, setMinutes: (number | null)[], startedAt = START) {
    const h = await createSession(db, {
      exerciseId,
      startedAt,
      endedAt: new Date(new Date(startedAt).getTime() + (durationSeconds ?? 0) * 1000).toISOString(),
      setSeeds: setMinutes.map(() => ({ isCompleted: true })),
    });
    const base = new Date(startedAt).getTime();
    for (let i = 0; i < setMinutes.length; i += 1) {
      const m = setMinutes[i];
      await db
        .update(sets)
        .set({ completedAt: m == null ? null : new Date(base + m * 60_000).toISOString() })
        .where(eq(sets.id, h.setIds[i]!));
    }
    await db.update(workoutSessions).set({ durationSeconds }).where(eq(workoutSessions.id, h.sessionId));
    return h.sessionId;
  }

  async function sqlDuration(sessionId: string) {
    const [row] = await db
      .select({ d: effectiveDurationSql })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));
    return row?.d ?? null;
  }

  it('SQL ile saf kural aynı sonucu verir', async () => {
    const cases: [number | null, (number | null)[]][] = [
      [3900, [10, 30, 60]],
      [23 * 3600, [10, 30, 60]],
      [40 * 3600, [null, null]],
      [10 * 3600, [9 * 60]],
      [3000, [-30]],
      [null, [20]],
      [1200, []],
    ];
    for (const [stored, minutes] of cases) {
      const id = await finished(stored, minutes);
      const known = minutes.filter((m): m is number => m != null);
      const lastSetAt = known.length > 0 ? at(Math.max(...known)) : null;
      expect(await sqlDuration(id)).toBe(effectiveDurationSeconds({ startedAt: START, durationSeconds: stored, lastSetAt }));
    }
  });

  it('SQL kardiyo süresini ekler', async () => {
    const id = await finished(5 * 3600, [30]);
    await db.insert(cardioSegments).values({ id: 'c1', sessionId: id, exerciseId, orderIndex: 1, durationSeconds: 1200 });
    expect(await sqlDuration(id)).toBe(1800 + FINISH_GRACE_SECONDS + 1200);
  });

  it('İlerleme süre kartı: unutulan seans şişirmez, bitmemiş sayılmaz, ortalama makul', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
    // Normal: 60 dk
    await finished(3600, [20, 50], '2026-10-06T10:00:00.000Z');
    // Unutulmuş: 45. dakikada son set, 20 saat sonra bitirilmiş → 55 dk
    await finished(20 * 3600, [15, 45], '2026-10-07T10:00:00.000Z');
    // Bitmemiş (endedAt yok): sayılmaz
    await createSession(db, { exerciseId, startedAt: '2026-10-08T10:00:00.000Z', setSeeds: [{ isCompleted: true }] });

    const data = await loadProgressData(db);
    expect(data.sessions).toHaveLength(2);
    const card = progressStats(data, 'year', new Date()).find((c) => c.metric === 'duration')!;
    expect(card.value).toBe('1 sa 55');
    expect(card.footnote).toBe('ort. 58 dk');
  });

  it('özet de aynı süreyi gösterir', async () => {
    const id = await finished(20 * 3600, [15, 45]);
    expect((await loadWorkoutSummary(db, id))?.durationSeconds).toBe(45 * 60 + FINISH_GRACE_SECONDS);
  });

  it('bitişte yazılan süre de sınırlı (geç basılan "Bitir")', async () => {
    const h = await createSession(db, { exerciseId, startedAt: START, setSeeds: [{ isCompleted: true }] });
    await db.update(sets).set({ completedAt: at(40) }).where(eq(sets.id, h.setIds[0]!));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at(9 * 60))); // 9 saat sonra "Bitir"
    await finishSessionRecord(db, {
      sessionId: h.sessionId,
      sessionExerciseIds: [h.sessionExerciseId],
      pendingFilledIds: [],
      mode: 'delete',
    });
    const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, h.sessionId));
    expect(row?.endedAt).toBe(at(9 * 60));
    expect(row?.durationSeconds).toBe(40 * 60 + FINISH_GRACE_SECONDS);
  });
});
