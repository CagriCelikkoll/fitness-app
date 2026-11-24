/**
 * 0.13 Bölüm 2: iki rekor türü (en ağır kilo, tahmini 1RM). Kural tek
 * yerde (`recordEvents.ts`); ana sayfa, İlerleme, özet, rekor sayfası ve
 * hareket detayı aynı sonucu vermeli.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { sessionExercises, sets } from '@/db/schema';
import { finishSessionRecord } from '@/lib/finishSession';
import { loadProgressData, metricValue, periodRange } from '@/lib/progressStats';
import {
  bestsBeforeSession,
  findSetRecords,
  loadExerciseRecordSessions,
  loadPreviousExerciseBest,
  loadRecordHistory,
  sessionRecordSetIds,
  loadSessionRecordPage,
  recordBadgeText,
  recordComparison,
  recordEvents,
  recordKindsBySession,
  recordKindsText,
  sessionRecordPage,
  type ExerciseBest,
  type RecordHistoryRow,
} from '@/lib/recordEvents';
import { latestRecord } from '@/lib/today';
import { loadWorkoutSummary, summaryRecordPage } from '@/lib/workoutSummary';
import { createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

let nextId = 0;
function row(
  sessionId: string,
  day: number,
  weightKg: number,
  reps: number,
  extra: Partial<RecordHistoryRow> = {}
): RecordHistoryRow {
  nextId += 1;
  const d = String(day).padStart(2, '0');
  return {
    id: `set-${nextId}`,
    setNumber: nextId,
    setType: 'normal',
    weightKg,
    reps,
    isCompleted: true,
    completedAt: `2026-01-${d}T10:${String(nextId % 60).padStart(2, '0')}:00.000Z`,
    exerciseId: 'bench',
    exerciseName: 'Bench',
    sessionId,
    sessionStartedAt: `2026-01-${d}T10:00:00.000Z`,
    ...extra,
  };
}

const kindsOf = (rows: RecordHistoryRow[], sessionId: string) => sessionRecordPage(recordEvents(rows), sessionId)?.kinds ?? null;

describe('rekor türleri', () => {
  it('ağırlık rekoru ama 1RM değil: daha ağır, daha az tekrar', () => {
    // 80 × 10 ≈ 106,7; 85 × 3 = 93,5 → yalnızca en ağır kilo
    const rows = [row('a', 1, 80, 10), row('b', 2, 85, 3)];
    expect(kindsOf(rows, 'b')).toEqual(['weight']);
    const page = sessionRecordPage(recordEvents(rows), 'b')!;
    expect(page.previousWeight).toEqual({ weightKg: 80, reps: 10 });
    expect(page.previousE1rm).toBeNull();
    expect(recordComparison(page)).toEqual({
      previousText: '80 × 10',
      metricLabel: 'En ağır kilo',
      metricValue: '85 kg',
      gain: '+5',
    });
    expect(recordBadgeText(page.kinds)).toBe('EN AĞIR KİLO');
  });

  it('1RM rekoru ama ağırlık değil: aynı kilo, daha çok tekrar', () => {
    const rows = [row('a', 1, 80, 5), row('b', 2, 80, 8)];
    expect(kindsOf(rows, 'b')).toEqual(['e1rm']);
    const page = sessionRecordPage(recordEvents(rows), 'b')!;
    expect(recordComparison(page)).toMatchObject({ previousText: '80 × 5', metricLabel: 'Tahmini 1RM' });
    expect(recordBadgeText(page.kinds)).toBe('TAHMİNİ 1RM');
  });

  it('ikisi birden: tek olay, iki etiket', () => {
    const rows = [row('a', 1, 80, 5), row('b', 2, 85, 5)];
    const events = recordEvents(rows).filter((e) => e.sessionId === 'b');
    expect(events).toHaveLength(1);
    expect(events[0]!.kinds).toEqual(['weight', 'e1rm']);
    expect(recordBadgeText(events[0]!.kinds)).toBe('EN AĞIR KİLO · TAHMİNİ 1RM');
    expect(recordKindsText(events[0]!.kinds)).toBe('en ağır kilo · tahmini 1RM');
  });

  it('ilk antrenman: rekor yok', () => {
    expect(kindsOf([row('a', 1, 200, 1)], 'a')).toBeNull();
  });

  it('ısınma seti hiçbir türde rekor değil', () => {
    const rows = [row('a', 1, 80, 5), row('b', 2, 120, 5, { setType: 'warmup' })];
    expect(kindsOf(rows, 'b')).toBeNull();
  });

  it('12 tekrar üstü: 1RM yok ama en ağır kilo sayılır', () => {
    const rows = [row('a', 1, 40, 15), row('b', 2, 45, 15)];
    const page = sessionRecordPage(recordEvents(rows), 'b')!;
    expect(page.kinds).toEqual(['weight']);
    expect(page.e1rm).toBeNull();
  });

  it('eşit kilo rekor değil', () => {
    expect(kindsOf([row('a', 1, 100, 3), row('b', 2, 100, 2)], 'b')).toBeNull();
  });

  it('seans içinde ikinci rekor birinciyi baz alır; "önceki" antrenman öncesi değer', () => {
    const prev: ExerciseBest = { e1rm: null, weight: { weightKg: 80, reps: 5 } };
    const recs = findSetRecords(
      [
        { id: 's1', setNumber: 1, setType: 'normal', weightKg: 85, reps: 15, isCompleted: true, completedAt: 't1' },
        { id: 's2', setNumber: 2, setType: 'normal', weightKg: 82.5, reps: 15, isCompleted: true, completedAt: 't2' },
        { id: 's3', setNumber: 3, setType: 'normal', weightKg: 90, reps: 15, isCompleted: true, completedAt: 't3' },
      ],
      prev
    );
    expect(recs.map((r) => r.setId)).toEqual(['s1', 's3']);
    expect(recs[1]!.previousWeight).toEqual({ weightKg: 80, reps: 5 });
  });

  it('hareket detayı: rekorlu seanslar ve türleri', () => {
    const rows = [row('a', 1, 80, 10), row('b', 2, 85, 3), row('c', 3, 80, 12), row('d', 4, 70, 5)];
    const map = recordKindsBySession(recordEvents(rows), 'bench');
    expect([...map]).toEqual([
      ['b', ['weight']],
      ['c', ['e1rm']],
    ]);
  });

  it('bestsBeforeSession ile recordEvents aynı sonucu verir (özet = sayfa)', () => {
    const rows = [row('a', 1, 80, 10), row('b', 2, 85, 3), row('c', 3, 82.5, 10)];
    const before = bestsBeforeSession(rows, 'c').get('bench')!;
    const fromSummary = findSetRecords(
      rows.filter((r) => r.sessionId === 'c'),
      before
    );
    const fromHistory = recordEvents(rows).filter((e) => e.sessionId === 'c');
    expect(fromSummary.map((r) => r.kinds)).toEqual(fromHistory.map((e) => e.kinds));
  });
});

describe('antrenman sırasındaki 🏆 rozeti', () => {
  const set = (id: string, weightKg: number, reps: number, extra: Partial<RecordHistoryRow> = {}) => ({
    id,
    setNumber: Number(id.slice(1)),
    setType: 'normal',
    weightKg,
    reps,
    isCompleted: true,
    completedAt: `2026-01-02T10:0${id.slice(1)}:00.000Z`,
    ...extra,
  });
  const prev: ExerciseBest = { e1rm: { weightKg: 80, reps: 10, e1rm: 80 * (1 + 10 / 30) }, weight: { weightKg: 80, reps: 10 } };

  it('en ağır kilo da rozet alır (1RM rekoru olmasa bile)', () => {
    expect([...sessionRecordSetIds([set('s1', 85, 3)], prev)]).toEqual(['s1']);
  });

  it('1RM rekoru rozet alır', () => {
    expect([...sessionRecordSetIds([set('s1', 80, 12)], prev)]).toEqual(['s1']);
  });

  it('rekor değilse, ısınmaysa ya da tamamlanmamışsa rozet yok', () => {
    expect(sessionRecordSetIds([set('s1', 75, 10)], prev).size).toBe(0);
    expect(sessionRecordSetIds([set('s1', 100, 5, { setType: 'warmup' })], prev).size).toBe(0);
    expect(sessionRecordSetIds([set('s1', 100, 5, { isCompleted: false })], prev).size).toBe(0);
  });

  it('hareketin ilk antrenmanı: rozet yok', () => {
    expect(sessionRecordSetIds([set('s1', 100, 5)], null).size).toBe(0);
  });

  it('geri alınan setin rozeti kalkar; sonraki set ona göre değerlendirilir', () => {
    const done = [set('s1', 85, 3), set('s2', 87.5, 3)];
    expect([...sessionRecordSetIds(done, prev)]).toEqual(['s1', 's2']);
    const undone = [set('s1', 85, 3, { isCompleted: false }), set('s2', 87.5, 3)];
    expect([...sessionRecordSetIds(undone, prev)]).toEqual(['s2']);
  });

  it('active.tsx: rozet yeni kuraldan; ✓ titreşimi ve set tamamlama değişmedi', () => {
    const src = readFileSync(path.resolve(__dirname, '..', 'app/session/active.tsx'), 'utf8');
    expect(src).toContain('sessionRecordSetIds(setsData ?? [], badgeBest.value)');
    expect(src).toContain('loadPreviousExerciseBest(db, exercise.id, sessionId)');
    expect(src).not.toContain('findSessionRecordSetIds(');
    // Titreşim kararı eskisi gibi tahmini 1RM
    expect(src).toContain('isNewE1rmRecord(weightKg, reps, sessionRecordBaseline(previousBest.value, others))');
    expect(src).toContain('await completeSetRecord(db, set.id, parsed);');
  });
});

describe('gerçek SQLite: bütün ekranlar aynı kural', () => {
  let t: TestDb;
  let db: Db;

  beforeEach(() => {
    t = createTestDb();
    db = t.db;
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    t.close();
  });

  async function workout(exerciseId: string, startedAt: string, setSeeds: { weightKg: number; reps: number }[]) {
    vi.setSystemTime(new Date(startedAt));
    const h = await createSession(db, {
      exerciseId,
      startedAt,
      setSeeds: setSeeds.map((s) => ({ ...s, isCompleted: false })),
    });
    const base = new Date(startedAt).getTime();
    for (let i = 0; i < h.setIds.length; i += 1) {
      await db
        .update(sets)
        .set({ isCompleted: true, completedAt: new Date(base + (i + 1) * 300_000).toISOString() })
        .where(eq(sets.id, h.setIds[i]!));
    }
    vi.setSystemTime(new Date(base + 45 * 60_000));
    await finishSessionRecord(db, {
      sessionId: h.sessionId,
      sessionExerciseIds: [h.sessionExerciseId],
      pendingFilledIds: [],
      mode: 'delete',
    });
    return h.sessionId;
  }

  it('daha ağır ama 1RM düşük: özet, sayfa, ana sayfa, İlerleme, hareket detayı rekor görüyor', async () => {
    const bench = await seedExercise(db, { name: 'Bench Press', nameTr: 'Göğüs Presi' });
    await workout(bench, '2026-10-06T10:00:00.000Z', [{ weightKg: 80, reps: 10 }]);
    const heavy = await workout(bench, '2026-10-08T10:00:00.000Z', [{ weightKg: 85, reps: 3 }]);

    const page = await loadSessionRecordPage(db, heavy);
    expect(page).toMatchObject({ weightKg: 85, reps: 3, kinds: ['weight'], previousWeight: { weightKg: 80, reps: 10 } });

    const summary = (await loadWorkoutSummary(db, heavy))!;
    expect(summary.records).toHaveLength(1);
    expect(summaryRecordPage(summary.records)).toEqual(page);

    expect(latestRecord(await loadRecordHistory(db))).toMatchObject({ weightKg: 85, kinds: ['weight'] });

    const data = await loadProgressData(db);
    expect(metricValue('records', data, periodRange('year', new Date('2026-10-10T12:00:00.000Z'), 0))).toBe(1);

    expect([...(await loadExerciseRecordSessions(db, bench))]).toEqual([[heavy, ['weight']]]);
  });

  it('rozet için önceki en iyi: bitmiş antrenmanlar, açık seans hariç', async () => {
    const bench = await seedExercise(db);
    await workout(bench, '2026-10-06T10:00:00.000Z', [{ weightKg: 80, reps: 10 }]);
    await workout(bench, '2026-10-07T10:00:00.000Z', [{ weightKg: 90, reps: 2 }]);
    // Açık (bitmemiş) seans: tamamlanmış ağır seti baz olmamalı
    const open = await createSession(db, {
      exerciseId: bench,
      startedAt: '2026-10-08T10:00:00.000Z',
      setSeeds: [{ weightKg: 95, reps: 3 }],
    });
    const best = await loadPreviousExerciseBest(db, bench, open.sessionId);
    expect(best?.weight).toEqual({ weightKg: 90, reps: 2 });
    expect(best?.e1rm).toMatchObject({ weightKg: 80, reps: 10 });
    expect(await loadPreviousExerciseBest(db, await seedExercise(db, { name: 'Yeni' }), open.sessionId)).toBeNull();

    // Açık seansın seti en ağır kilo → rozet
    const rows = await db.select().from(sets).where(eq(sets.sessionExerciseId, open.sessionExerciseId));
    expect([...sessionRecordSetIds(rows, best)]).toEqual([open.setIds[0]]);
  });

  it('aynı hareket seansta iki kez eklenmiş: özet ve geçmiş aynı', async () => {
    const bench = await seedExercise(db);
    await workout(bench, '2026-10-06T10:00:00.000Z', [{ weightKg: 80, reps: 5 }]);
    vi.setSystemTime(new Date('2026-10-08T10:00:00.000Z'));
    const h = await createSession(db, {
      exerciseId: bench,
      startedAt: '2026-10-08T10:00:00.000Z',
      setSeeds: [{ weightKg: 82.5, reps: 5 }],
    });
    await db.insert(sessionExercises).values({ id: 'se-2', sessionId: h.sessionId, exerciseId: bench, orderIndex: 1 });
    await db.insert(sets).values({
      id: 'set-2',
      sessionExerciseId: 'se-2',
      setNumber: 1,
      reps: 5,
      weightKg: 85,
      isCompleted: true,
      completedAt: '2026-10-08T10:30:00.000Z',
    });
    await db.update(sets).set({ completedAt: '2026-10-08T10:10:00.000Z' }).where(eq(sets.id, h.setIds[0]!));
    vi.setSystemTime(new Date('2026-10-08T10:45:00.000Z'));
    await finishSessionRecord(db, {
      sessionId: h.sessionId,
      sessionExerciseIds: [h.sessionExerciseId, 'se-2'],
      pendingFilledIds: [],
      mode: 'delete',
    });
    const summary = (await loadWorkoutSummary(db, h.sessionId))!;
    expect(summary.records).toHaveLength(1);
    expect(summaryRecordPage(summary.records)).toEqual(await loadSessionRecordPage(db, h.sessionId));
    expect(summary.records[0]).toMatchObject({ weightKg: 85 });
  });
});
