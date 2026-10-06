/**
 * Süperset: grup bütünlüğü ve aktif antrenmanda dinlenme kararı.
 *
 * İlk blok regresyon koruması: süperset olmayan harekette
 * `afterSetCompleted` HER durumda v1.9 öncesi davranışı (dinlenme var,
 * sıradaki yok) döndürmeli.
 */

import { describe, expect, it } from 'vitest';

import {
  afterSetCompleted,
  isLinkedWithNext,
  linkWithNext,
  moveAndDetach,
  normalizeSupersetGroups,
  removeAndNormalize,
  supersetPositions,
  unlinkAfter,
  type SessionExerciseState,
} from '@/lib/superset';

/** `done` tamamlanmış + `open` tamamlanmamış setli hareket */
function ex(
  name: string,
  group: number | null,
  done: number,
  open: number
): SessionExerciseState {
  return {
    name,
    supersetGroup: group,
    sets: [
      ...Array.from({ length: done }, (_, i) => ({ id: `${name}-d${i}`, isCompleted: true })),
      ...Array.from({ length: open }, (_, i) => ({ id: `${name}-o${i}`, isCompleted: false })),
    ],
  };
}

const NORMAL = { startRest: true, next: null };

describe('afterSetCompleted — süperset olmayan hareket (regresyon)', () => {
  const cases: { title: string; exercises: SessionExerciseState[]; index: number }[] = [
    { title: 'tek hareketli seans', exercises: [ex('Bench', null, 1, 2)], index: 0 },
    {
      title: 'sonraki harekette eksik set var',
      exercises: [ex('Bench', null, 1, 2), ex('Row', null, 0, 3)],
      index: 0,
    },
    {
      title: 'önceki harekette eksik set var',
      exercises: [ex('Bench', null, 0, 3), ex('Row', null, 1, 2)],
      index: 1,
    },
    {
      title: 'tüm setler bitti',
      exercises: [ex('Bench', null, 3, 0), ex('Row', null, 3, 0)],
      index: 1,
    },
    {
      title: 'yanında süperset grubu olan normal hareket',
      exercises: [ex('Squat', null, 1, 2), ex('Bench', 1, 0, 3), ex('Row', 1, 0, 3)],
      index: 0,
    },
    {
      title: 'grubun hemen arkasındaki normal hareket',
      exercises: [ex('Bench', 1, 3, 0), ex('Row', 1, 0, 3), ex('Curl', null, 1, 2)],
      index: 2,
    },
    {
      title: 'tek üyeli (bozuk) grup numarası süperset sayılmaz',
      exercises: [ex('Bench', 4, 1, 2), ex('Row', null, 0, 3)],
      index: 0,
    },
    {
      title: 'aynı numara ama ardışık değil — süperset sayılmaz',
      exercises: [ex('Bench', 1, 1, 2), ex('Squat', null, 0, 3), ex('Row', 1, 0, 3)],
      index: 0,
    },
    { title: 'setsiz hareket', exercises: [ex('Bench', null, 0, 0)], index: 0 },
  ];

  for (const c of cases) {
    it(c.title, () => {
      const completedSetId = c.exercises[c.index].sets[0]?.id ?? 'yok';
      expect(
        afterSetCompleted({ exercises: c.exercises, currentIndex: c.index, completedSetId })
      ).toEqual(NORMAL);
    });
  }
});

describe('afterSetCompleted — süperset akışı', () => {
  it('A1 seti biter, A2de eksik set var → dinlenme yok, sıradaki A2', () => {
    const exercises = [ex('Bench', 1, 1, 2), ex('Row', 1, 0, 3)];
    expect(
      afterSetCompleted({ exercises, currentIndex: 0, completedSetId: 'Bench-d0' })
    ).toEqual({ startRest: false, next: { exerciseIndex: 1, label: 'Sıradaki: Row' } });
  });

  it('A2 seti biter (son üye), A1de eksik set var → dinlenme var, sıradaki A1', () => {
    const exercises = [ex('Bench', 1, 1, 2), ex('Row', 1, 1, 2)];
    expect(
      afterSetCompleted({ exercises, currentIndex: 1, completedSetId: 'Row-d0' })
    ).toEqual({ startRest: true, next: { exerciseIndex: 0, label: 'Sıradaki tur: Bench' } });
  });

  it('son tur, tüm üyeler bitti → dinlenme var, sıradaki yok', () => {
    const exercises = [ex('Bench', 1, 3, 0), ex('Row', 1, 3, 0)];
    expect(
      afterSetCompleted({ exercises, currentIndex: 1, completedSetId: 'Row-d2' })
    ).toEqual(NORMAL);
  });

  it('henüz tazelenmemiş veri: az önce tamamlanan set tamamlanmış sayılır', () => {
    // Row'un son seti DB'de tamamlandı ama okunan veri eski (isCompleted: false)
    const exercises = [ex('Bench', 1, 3, 0), ex('Row', 1, 2, 1)];
    expect(
      afterSetCompleted({ exercises, currentIndex: 1, completedSetId: 'Row-o0' })
    ).toEqual(NORMAL);

    // A1'in tek eksik seti az önce tamamlandı: A2 hâlâ bekliyor
    const first = [ex('Bench', 1, 2, 1), ex('Row', 1, 2, 1)];
    expect(
      afterSetCompleted({ exercises: first, currentIndex: 0, completedSetId: 'Bench-o0' })
    ).toEqual({ startRest: false, next: { exerciseIndex: 1, label: 'Sıradaki: Row' } });
  });

  it('farklı set sayıları: A 3, B 4 set → 4. turda B normal dinlenme', () => {
    // A'nın 3 seti bitti, B'nin 4. seti az önce tamamlandı
    const exercises = [ex('Bench', 1, 3, 0), ex('Row', 1, 4, 0)];
    expect(
      afterSetCompleted({ exercises, currentIndex: 1, completedSetId: 'Row-d3' })
    ).toEqual(NORMAL);

    // 3. turun sonunda (B 3/4) A'da set kalmadı: sıradaki tur yok ama dinlenme var
    const thirdRound = [ex('Bench', 1, 3, 0), ex('Row', 1, 3, 1)];
    expect(
      afterSetCompleted({ exercises: thirdRound, currentIndex: 1, completedSetId: 'Row-d2' })
    ).toEqual(NORMAL);
  });

  it('farklı set sayıları: A 4, B 3 set → 4. turda A normal dinlenme', () => {
    const exercises = [ex('Bench', 1, 4, 0), ex('Row', 1, 3, 0)];
    expect(
      afterSetCompleted({ exercises, currentIndex: 0, completedSetId: 'Bench-d3' })
    ).toEqual(NORMAL);
  });

  describe('üç üyeli grup (A1-A2-A3)', () => {
    const group = (a: [number, number], b: [number, number], c: [number, number]) => [
      ex('Bench', 1, ...a),
      ex('Row', 1, ...b),
      ex('Curl', 1, ...c),
    ];

    it('A1 → sıradaki A2, dinlenme yok', () => {
      expect(
        afterSetCompleted({
          exercises: group([1, 2], [0, 3], [0, 3]),
          currentIndex: 0,
          completedSetId: 'Bench-d0',
        })
      ).toEqual({ startRest: false, next: { exerciseIndex: 1, label: 'Sıradaki: Row' } });
    });

    it('A2 → sıradaki A3, dinlenme yok', () => {
      expect(
        afterSetCompleted({
          exercises: group([1, 2], [1, 2], [0, 3]),
          currentIndex: 1,
          completedSetId: 'Row-d0',
        })
      ).toEqual({ startRest: false, next: { exerciseIndex: 2, label: 'Sıradaki: Curl' } });
    });

    it('A3 → dinlenme var, sıradaki tur A1', () => {
      expect(
        afterSetCompleted({
          exercises: group([1, 2], [1, 2], [1, 2]),
          currentIndex: 2,
          completedSetId: 'Curl-d0',
        })
      ).toEqual({ startRest: true, next: { exerciseIndex: 0, label: 'Sıradaki tur: Bench' } });
    });

    it('A2 bitmişse A1 → A3e atlar', () => {
      expect(
        afterSetCompleted({
          exercises: group([2, 1], [3, 0], [1, 2]),
          currentIndex: 0,
          completedSetId: 'Bench-d1',
        })
      ).toEqual({ startRest: false, next: { exerciseIndex: 2, label: 'Sıradaki: Curl' } });
    });
  });

  it('iki ayrı grup birbirine karışmıyor', () => {
    // A: Bench+Row, B: Curl+Pushdown. A2 biter; B'nin eksik setleri sayılmaz
    const exercises = [
      ex('Bench', 1, 3, 0),
      ex('Row', 1, 3, 0),
      ex('Curl', 2, 0, 3),
      ex('Pushdown', 2, 0, 3),
    ];
    expect(
      afterSetCompleted({ exercises, currentIndex: 1, completedSetId: 'Row-d2' })
    ).toEqual(NORMAL);
  });
});

describe('normalizeSupersetGroups', () => {
  it('ardışık aynı numaralar bir grup', () => {
    expect(normalizeSupersetGroups([1, 1, null, 2, 2, 2])).toEqual([1, 1, null, 2, 2, 2]);
  });

  it('tek üyeli grup → null', () => {
    expect(normalizeSupersetGroups([1, null, 2, 2])).toEqual([null, null, 1, 1]);
  });

  it('yeniden numaralama sıraya göre', () => {
    expect(normalizeSupersetGroups([7, 7, 3, 3])).toEqual([1, 1, 2, 2]);
  });

  it('iki ayrı grup, aynı numara ardışık değilse ayrı gruplar', () => {
    expect(normalizeSupersetGroups([5, 5, null, 5, 5])).toEqual([1, 1, null, 2, 2]);
  });

  it('bitişik iki farklı numara ayrı gruplar', () => {
    expect(normalizeSupersetGroups([1, 1, 2, 2])).toEqual([1, 1, 2, 2]);
  });

  it('boş ve tamamen null', () => {
    expect(normalizeSupersetGroups([])).toEqual([]);
    expect(normalizeSupersetGroups([null, null])).toEqual([null, null]);
  });
});

describe('bağla / ayır', () => {
  it('iki normal hareketi bağlar', () => {
    expect(linkWithNext([null, null, null], 0)).toEqual([1, 1, null]);
  });

  it('gruba üçüncü üye eklenir (A1, A2, A3)', () => {
    const groups = linkWithNext(linkWithNext([null, null, null], 0), 1);
    expect(groups).toEqual([1, 1, 1]);
    expect(supersetPositions(groups).map((p) => p?.label)).toEqual(['A1', 'A2', 'A3']);
  });

  it('iki grup bağlanınca birleşir', () => {
    expect(linkWithNext([1, 1, 2, 2], 1)).toEqual([1, 1, 1, 1]);
  });

  it('ayırma grubu ikiye böler, tek kalanlar null olur', () => {
    expect(unlinkAfter([1, 1, 1], 0)).toEqual([null, 1, 1]);
    expect(unlinkAfter([1, 1, 1, 1], 1)).toEqual([1, 1, 2, 2]);
    expect(unlinkAfter([1, 1], 0)).toEqual([null, null]);
  });

  it('isLinkedWithNext', () => {
    expect(isLinkedWithNext([1, 1, null], 0)).toBe(true);
    expect(isLinkedWithNext([1, 1, null], 1)).toBe(false);
    expect(isLinkedWithNext([1, 1, 2, 2], 1)).toBe(false);
  });

  it('birden fazla grup harfle ayrılıyor', () => {
    const positions = supersetPositions([1, 1, null, 2, 2]);
    expect(positions.map((p) => p?.label ?? null)).toEqual(['A1', 'A2', null, 'B1', 'B2']);
    expect(positions[1]?.isLast).toBe(true);
    expect(positions[0]?.isLast).toBe(false);
  });
});

describe('yeniden sıralama ve silme', () => {
  const items = (groups: (number | null)[]) =>
    groups.map((supersetGroup, i) => ({ id: `e${i}`, supersetGroup }));

  it('taşınan üye grubundan çıkıyor', () => {
    // A1 A2 A3 normal → A3'ü aşağı taşı
    const moved = moveAndDetach(items([1, 1, 1, null]), 2, 1);
    expect(moved.map((i) => i.id)).toEqual(['e0', 'e1', 'e3', 'e2']);
    expect(moved.map((i) => i.supersetGroup)).toEqual([1, 1, null, null]);
  });

  it('iki üyeli gruptan taşınan üye grubu dağıtıyor', () => {
    const moved = moveAndDetach(items([null, 1, 1]), 1, -1);
    expect(moved.map((i) => i.id)).toEqual(['e1', 'e0', 'e2']);
    expect(moved.map((i) => i.supersetGroup)).toEqual([null, null, null]);
  });

  it('normal hareket grubun ortasına girerse grup bölünüyor', () => {
    // A1 A2 A3 N → N yukarı: A1 A2 N A3 → A3 tek kaldı
    const moved = moveAndDetach(items([1, 1, 1, null]), 3, -1);
    expect(moved.map((i) => i.id)).toEqual(['e0', 'e1', 'e3', 'e2']);
    expect(moved.map((i) => i.supersetGroup)).toEqual([1, 1, null, null]);
  });

  it('sınırda taşıma değişiklik yapmıyor', () => {
    const list = items([1, 1]);
    expect(moveAndDetach(list, 0, -1)).toBe(list);
  });

  it('silmede tek kalan üye null oluyor', () => {
    const rest = removeAndNormalize(items([1, 1, null]), 0);
    expect(rest.map((i) => i.id)).toEqual(['e1', 'e2']);
    expect(rest.map((i) => i.supersetGroup)).toEqual([null, null]);
  });

  it('üç üyeli gruptan silinince kalan ikisi grup olarak kalıyor', () => {
    const rest = removeAndNormalize(items([1, 1, 1]), 1);
    expect(rest.map((i) => i.supersetGroup)).toEqual([1, 1]);
  });
});
