import { describe, expect, it } from 'vitest';

import {
  buildSessionPoints,
  computeRecords,
  E1RM_MAX_REPS,
  epley,
  findSessionRecordSetIds,
  isNewE1rmRecord,
  recentE1rmTrend,
  sessionRecordBaseline,
  type SessionSet,
  type SetRow,
} from '@/lib/exerciseProgress';

function row(
  sessionId: string,
  date: string,
  weightKg: number | null,
  reps: number | null
): SetRow {
  return { sessionId, date, weightKg, reps };
}

describe('epley', () => {
  it('1 tekrarın e1RM\'i ağırlığın kendisi', () => {
    expect(epley(100, 1)).toBe(100);
  });

  it('5 tekrar ≈ 116,67', () => {
    expect(epley(100, 5)).toBeCloseTo(116.67, 2);
  });

  it('12 tekrar hâlâ hesaplanıyor, 13 null', () => {
    expect(E1RM_MAX_REPS).toBe(12);
    expect(epley(100, 12)).toBeCloseTo(140, 5);
    expect(epley(100, 13)).toBeNull();
  });

  it('0 tekrar null', () => {
    expect(epley(100, 0)).toBeNull();
  });

  it('ağırlık 0 ya da null → null, hata fırlatmıyor', () => {
    expect(epley(0, 5)).toBeNull();
    expect(epley(null, 5)).toBeNull();
    expect(epley(100, null)).toBeNull();
  });
});

describe('buildSessionPoints', () => {
  it('seans başına en iyi e1RM, en ağır set ve toplam hacim', () => {
    const points = buildSessionPoints([
      row('s1', '2026-09-01T10:00:00.000Z', 100, 5), // e1RM 116,67
      row('s1', '2026-09-01T10:00:00.000Z', 110, 1), // e1RM 110, en ağır
      row('s1', '2026-09-01T10:00:00.000Z', 80, 10), // e1RM 106,67
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]!.e1rm).toBeCloseTo(116.67, 2);
    expect(points[0]!.topWeight).toBe(110);
    expect(points[0]!.volume).toBe(100 * 5 + 110 * 1 + 80 * 10);
    expect(points[0]!.bestSet).toEqual({ weightKg: 100, reps: 5 });
  });

  it('12+ tekrarlı set e1RM\'e girmiyor ama hacme giriyor', () => {
    const points = buildSessionPoints([
      row('s1', '2026-09-01T10:00:00.000Z', 60, 8), // e1RM 76
      row('s1', '2026-09-01T10:00:00.000Z', 70, 15), // e1RM yok (87,5 olurdu)
    ]);

    expect(points[0]!.e1rm).toBeCloseTo(76, 5);
    expect(points[0]!.topWeight).toBe(70);
    expect(points[0]!.volume).toBe(60 * 8 + 70 * 15);
  });

  it('seanslar tarihe göre artan sırada', () => {
    const points = buildSessionPoints([
      row('s2', '2026-09-08T10:00:00.000Z', 100, 5),
      row('s1', '2026-09-01T10:00:00.000Z', 90, 5),
    ]);

    expect(points.map((p) => p.sessionId)).toEqual(['s1', 's2']);
  });

  it('vücut ağırlığı setleri: ağırlık metrikleri null, hacim 0', () => {
    const points = buildSessionPoints([
      row('s1', '2026-09-01T10:00:00.000Z', null, 12),
      row('s1', '2026-09-01T10:00:00.000Z', 0, 10),
    ]);

    expect(points[0]!.e1rm).toBeNull();
    expect(points[0]!.topWeight).toBeNull();
    expect(points[0]!.volume).toBe(0);
    expect(points[0]!.bestSet).toEqual({ weightKg: null, reps: 12 });
  });

  it('boş liste boş sonuç', () => {
    expect(buildSessionPoints([])).toEqual([]);
  });
});

describe('computeRecords', () => {
  it('her metriğin maksimumu ve kırıldığı seansın tarihi', () => {
    const points = buildSessionPoints([
      row('s1', '2026-09-01T10:00:00.000Z', 100, 5), // e1RM 116,67, hacim 500
      row('s2', '2026-09-08T10:00:00.000Z', 105, 1), // en ağır, e1RM 105
      row('s3', '2026-09-15T10:00:00.000Z', 60, 12), // hacim 720
    ]);

    const records = computeRecords(points);

    expect(records.e1rm?.value).toBeCloseTo(116.67, 2);
    expect(records.e1rm?.date).toBe('2026-09-01T10:00:00.000Z');
    expect(records.topWeight).toEqual({
      value: 105,
      date: '2026-09-08T10:00:00.000Z',
    });
    expect(records.volume).toEqual({
      value: 720,
      date: '2026-09-15T10:00:00.000Z',
    });
  });

  it('eşitlikte ilk ulaşılan tarih kalıyor', () => {
    const points = buildSessionPoints([
      row('s2', '2026-09-08T10:00:00.000Z', 100, 1),
      row('s1', '2026-09-01T10:00:00.000Z', 100, 1),
    ]);

    expect(computeRecords(points).topWeight?.date).toBe(
      '2026-09-01T10:00:00.000Z'
    );
  });

  it('veri yoksa ya da vücut ağırlığıysa rekorlar null', () => {
    expect(computeRecords([])).toEqual({
      e1rm: null,
      topWeight: null,
      volume: null,
    });

    const bodyweight = buildSessionPoints([
      row('s1', '2026-09-01T10:00:00.000Z', null, 15),
    ]);
    expect(computeRecords(bodyweight)).toEqual({
      e1rm: null,
      topWeight: null,
      volume: null,
    });
  });
});

describe('isNewE1rmRecord', () => {
  it('kesinlikle büyükse rekor', () => {
    expect(isNewE1rmRecord(100, 5, 116)).toBe(true);
  });

  it('eşitse rekor değil', () => {
    expect(isNewE1rmRecord(100, 1, 100)).toBe(false);
  });

  it('küçükse rekor değil', () => {
    expect(isNewE1rmRecord(90, 1, 100)).toBe(false);
  });

  it('önceki değer yoksa (ilk kez) rekor değil', () => {
    expect(isNewE1rmRecord(200, 1, null)).toBe(false);
  });

  it('e1RM hesaplanamıyorsa (13 tekrar, ağırlık 0) rekor değil', () => {
    expect(isNewE1rmRecord(100, 13, 50)).toBe(false);
    expect(isNewE1rmRecord(0, 5, 50)).toBe(false);
  });
});

function sessionSet(
  id: string,
  weightKg: number,
  reps: number,
  completedAt: string | null,
  overrides: Partial<SessionSet> = {}
): SessionSet {
  return {
    id,
    setNumber: Number(id.replace(/D/g, '')) || 1,
    setType: 'normal',
    weightKg,
    reps,
    isCompleted: completedAt != null,
    completedAt,
    ...overrides,
  };
}

describe('sessionRecordBaseline', () => {
  it('seansta önceki en iyiyi aşan set varsa onu baz alıyor', () => {
    const sets = [sessionSet('a1', 110, 1, '2026-09-25T10:00:00.000Z')];
    expect(sessionRecordBaseline(100, sets)).toBe(110);
  });

  it('tamamlanmamış ve ısınma setleri baz almıyor', () => {
    const sets = [
      sessionSet('a1', 150, 1, null),
      sessionSet('a2', 150, 1, '2026-09-25T10:00:00.000Z', { setType: 'warmup' }),
    ];
    expect(sessionRecordBaseline(100, sets)).toBe(100);
  });

  it('geçmiş yoksa null (ilk seansta rekor yok)', () => {
    const sets = [sessionSet('a1', 110, 1, '2026-09-25T10:00:00.000Z')];
    expect(sessionRecordBaseline(null, sets)).toBeNull();
  });
});

describe('findSessionRecordSetIds', () => {
  it('art arda iki rekor: ikincisi birinciyi baz alıyor', () => {
    const ids = findSessionRecordSetIds(
      [
        sessionSet('s1', 105, 1, '2026-09-25T10:00:00.000Z'), // rekor (>100)
        sessionSet('s2', 103, 1, '2026-09-25T10:05:00.000Z'), // 105'i geçmiyor
        sessionSet('s3', 107, 1, '2026-09-25T10:10:00.000Z'), // rekor (>105)
      ],
      100
    );
    expect([...ids]).toEqual(['s1', 's3']);
  });

  it('eşitlik rekor değil', () => {
    const ids = findSessionRecordSetIds(
      [sessionSet('s1', 100, 1, '2026-09-25T10:00:00.000Z')],
      100
    );
    expect(ids.size).toBe(0);
  });

  it('geri alınan (tamamlanmamış) setin rozeti yok, sonraki set yeniden değerlendiriliyor', () => {
    const ids = findSessionRecordSetIds(
      [
        sessionSet('s1', 110, 1, null), // geri alındı
        sessionSet('s2', 105, 1, '2026-09-25T10:05:00.000Z'),
      ],
      100
    );
    expect([...ids]).toEqual(['s2']);
  });

  it('tamamlanma sırasına göre değerlendiriliyor, set numarasına göre değil', () => {
    const ids = findSessionRecordSetIds(
      [
        sessionSet('s1', 110, 1, '2026-09-25T10:10:00.000Z'),
        sessionSet('s2', 105, 1, '2026-09-25T10:00:00.000Z'),
      ],
      100
    );
    expect([...ids].sort()).toEqual(['s1', 's2']);
  });

  it('geçmiş yoksa hiçbir set rekor değil', () => {
    const ids = findSessionRecordSetIds(
      [sessionSet('s1', 200, 1, '2026-09-25T10:00:00.000Z')],
      null
    );
    expect(ids.size).toBe(0);
  });
});

describe('recentE1rmTrend', () => {
  it('son 8 seans, tarihe göre artan', () => {
    const rows: SetRow[] = [];
    // Sırasız ekleniyor: 10 seans, 1..10 Eylül
    for (const day of [5, 1, 10, 3, 8, 2, 7, 4, 9, 6]) {
      const date = `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`;
      rows.push(row(`s${day}`, date, 100 + day, 1));
    }

    const trend = recentE1rmTrend(buildSessionPoints(rows));

    expect(trend).toHaveLength(8);
    expect(trend.map((p) => p.y)).toEqual([103, 104, 105, 106, 107, 108, 109, 110]);
    expect(trend[0]!.x).toBe('2026-09-03T10:00:00.000Z');
  });

  it('12+ tekrarlı setler e1RM\'e girmiyor; yalnız onlardan oluşan seans atlanıyor', () => {
    const trend = recentE1rmTrend(
      buildSessionPoints([
        row('s1', '2026-09-01T10:00:00.000Z', 100, 1),
        row('s2', '2026-09-02T10:00:00.000Z', 200, 15),
        row('s3', '2026-09-03T10:00:00.000Z', 60, 20),
        row('s3', '2026-09-03T10:00:00.000Z', 105, 1),
      ])
    );
    expect(trend).toEqual([
      { x: '2026-09-01T10:00:00.000Z', y: 100 },
      { x: '2026-09-03T10:00:00.000Z', y: 105 },
    ]);
  });
});
