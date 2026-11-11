import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  recordE1rmGain,
  recordEvents,
  recordHeadlineParts,
  recordMoreText,
  recordSetText,
  sessionRecordPage,
  type RecordHistoryRow,
} from '@/lib/recordEvents';
import { MIN_FONT_SIZE, RECORD_HEADLINE_SIZES, recordHeadlineSize } from '@/lib/typography';

let nextId = 0;

function row(
  sessionId: string,
  day: number,
  exerciseId: string,
  weightKg: number,
  reps: number,
  extra: Partial<RecordHistoryRow> = {}
): RecordHistoryRow {
  nextId += 1;
  const at = `2026-01-${String(day).padStart(2, '0')}T10:00:00.000Z`;
  return {
    id: `set-${nextId}`,
    setNumber: nextId,
    setType: 'normal',
    weightKg,
    reps,
    isCompleted: true,
    completedAt: `2026-01-${String(day).padStart(2, '0')}T10:${String(nextId % 60).padStart(2, '0')}:00.000Z`,
    exerciseId,
    exerciseName: exerciseId,
    sessionId,
    sessionStartedAt: at,
    ...extra,
  };
}

const pageFor = (rows: RecordHistoryRow[], sessionId: string) => sessionRecordPage(recordEvents(rows), sessionId);

describe('rekor sayfası çıkma koşulu', () => {
  it('rekor yoksa çıkmaz', () => {
    expect(pageFor([row('a', 1, 'bench', 80, 5), row('b', 2, 'bench', 75, 5)], 'b')).toBeNull();
  });

  it('eşitlemek rekor değil', () => {
    expect(pageFor([row('a', 1, 'bench', 80, 5), row('b', 2, 'bench', 80, 5)], 'b')).toBeNull();
  });

  it('hareketin ilk antrenmanı rekor sayılmaz', () => {
    expect(pageFor([row('a', 1, 'bench', 80, 5)], 'a')).toBeNull();
  });

  it('ısınma seti rekor sayılmaz', () => {
    const rows = [row('a', 1, 'bench', 80, 5), row('b', 2, 'bench', 100, 5, { setType: 'warmup' })];
    expect(pageFor(rows, 'b')).toBeNull();
  });

  it('tamamlanmamış set rekor sayılmaz', () => {
    const rows = [row('a', 1, 'bench', 80, 5), row('b', 2, 'bench', 100, 5, { isCompleted: false })];
    expect(pageFor(rows, 'b')).toBeNull();
  });

  it('başka antrenmandaki rekor bu antrenmanda çıkmaz', () => {
    const rows = [row('a', 1, 'bench', 80, 5), row('b', 2, 'bench', 90, 5), row('c', 3, 'bench', 70, 5)];
    expect(pageFor(rows, 'b')).not.toBeNull();
    expect(pageFor(rows, 'c')).toBeNull();
  });

  it('tek rekor: önceki en iyi ve kazanç', () => {
    const page = pageFor([row('a', 1, 'bench', 77.5, 5), row('b', 2, 'bench', 80, 5)], 'b')!;
    expect(page).toMatchObject({ exerciseName: 'bench', weightKg: 80, reps: 5, moreCount: 0 });
    expect(page.previous).toMatchObject({ weightKg: 77.5, reps: 5 });
    expect(recordMoreText(page.moreCount)).toBeNull();
    expect(recordE1rmGain(page)).toBe('+2,9');
  });

  it('önceki en iyi, seans başındaki en iyi setin kendisi', () => {
    const rows = [
      row('a', 1, 'bench', 70, 5),
      row('b', 2, 'bench', 77.5, 5),
      row('b', 2, 'bench', 60, 5),
      row('c', 3, 'bench', 80, 5),
      row('c', 3, 'bench', 82.5, 5),
    ];
    const page = pageFor(rows, 'c')!;
    expect(page.weightKg).toBe(82.5);
    expect(page.previous.weightKg).toBe(77.5);
  });

  it('birkaç rekor: en büyük e1RM gösterilir, kalanlar sayılır', () => {
    const rows = [
      row('a', 1, 'curl', 20, 8),
      row('a', 1, 'squat', 120, 5),
      row('a', 1, 'bench', 80, 5),
      row('b', 2, 'curl', 22.5, 8),
      row('b', 2, 'squat', 125, 5),
      row('b', 2, 'bench', 82.5, 5),
    ];
    const page = pageFor(rows, 'b')!;
    expect(page.exerciseName).toBe('squat');
    expect(page.moreCount).toBe(2);
    expect(recordMoreText(page.moreCount)).toBe('+2 rekor daha');
  });

  it('aynı harekette iki rekor seti tek rekor sayılır', () => {
    const rows = [row('a', 1, 'bench', 80, 5), row('b', 2, 'bench', 85, 5), row('b', 2, 'bench', 90, 5)];
    const page = pageFor(rows, 'b')!;
    expect(page.weightKg).toBe(90);
    expect(page.moreCount).toBe(0);
  });
});

describe('rekor sayfası metinleri', () => {
  it('kilo biçimi', () => {
    expect(recordHeadlineParts({ weightKg: 80, reps: 5 })).toEqual(['80 kg ', '× 5']);
    expect(recordHeadlineParts({ weightKg: 102.25, reps: 12 })).toEqual(['102,25 kg ', '× 12']);
    expect(recordSetText({ weightKg: 77.5, reps: 5 })).toBe('77,5 × 5');
  });

  it('görünmeyecek kadar küçük kazanç yazılmaz', () => {
    expect(recordE1rmGain({ e1rm: 100.02, previous: { weightKg: 100, reps: 1, e1rm: 100 } })).toBeNull();
  });
});

describe('dev yazı boyutu', () => {
  it('kısa yazı en büyük boyutta', () => {
    expect(recordHeadlineSize('5 kg × 8', 342)).toBe(RECORD_HEADLINE_SIZES[0]);
  });

  it('uzadıkça küçülür ve satıra sığar', () => {
    const size = (t: string) => recordHeadlineSize(t, 342);
    expect(size('122,5 kg × 12')).toBeLessThan(size('80 kg × 5'));
    for (const t of ['80 kg × 5', '122,5 kg × 12', '202,75 kg × 12']) {
      expect(size(t) * [...t].length * 0.625).toBeLessThanOrEqual(342);
    }
  });

  it('en dar ekranda bile okunur boyutun altına inmez', () => {
    expect(recordHeadlineSize('202,75 kg × 12', 100)).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });
});

describe('ekran', () => {
  const summary = readFileSync('app/session/summary.tsx', 'utf8');
  const page = readFileSync('src/components/RecordCelebration.tsx', 'utf8');

  it('özetten önce, yalnızca rekor varsa', () => {
    expect(summary).toContain('recordPage != null && !recordSeen');
    expect(summary.indexOf('<RecordCelebration')).toBeLessThan(summary.indexOf('label="Kaydet ve kapat"'));
    expect(summary).toContain('recordPage === undefined');
  });

  it('içerik: görsel, altın rozet ve düğme; paylaşım yok', () => {
    expect(page).toContain('cover="rekor"');
    expect(page).toContain('YENİ REKOR');
    expect(page).toContain('Önceki en iyi');
    expect(page).toContain('Tahmini 1RM');
    expect(page).toContain('label="Devam et" color="record"');
    expect(page).not.toContain('Paylaş');
  });

  it('active.tsx özete gitmeye devam ediyor', () => {
    expect(readFileSync('app/session/active.tsx', 'utf8')).toContain("pathname: '/session/summary'");
  });
});
