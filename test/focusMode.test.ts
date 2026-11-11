/**
 * Odak modu durum mantığı (v4.0a Bölüm 2): sıradaki set / hareket,
 * süperset sırası, yüzde, bölümlü çizgi, hazır değerler, Bitir onayı.
 */

import { describe, expect, it } from 'vitest';

import {
  elapsedAndPercent,
  exerciseAfterSet,
  finishConfirmation,
  focusLabel,
  focusSetIndex,
  focusSupersets,
  formatElapsed,
  nextAfterSet,
  nextUpText,
  prefillValues,
  earlierCompletedSet,
  progressSegments,
  repsA11yLabel,
  setChipText,
  setValueText,
  stepReps,
  stepWeight,
  supersetMemberLabels,
  weightA11yLabel,
  weightStep,
  workoutProgress,
  type FocusExercise,
} from '@/lib/focusMode';
import { decimalComma } from '@/lib/format';
import { formatSetSummary } from '@/lib/rir';

let seq = 0;
function ex(name: string, done: boolean[], supersetGroup: number | null = null): FocusExercise {
  return {
    name,
    supersetGroup,
    sets: done.map((isCompleted, i) => ({ id: `${name}-${i + 1}-${(seq += 1)}`, setNumber: i + 1, isCompleted })),
  };
}

describe('yüzde ve bölümlü çizgi', () => {
  it('tamamlanan / toplam set', () => {
    const list = [ex('Bench', [true, true, false]), ex('Row', [true, false]), ex('Lateral', [false, false, false])];
    expect(workoutProgress(list)).toEqual({ done: 3, total: 8, percent: 38 });
    expect(workoutProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('her hareket bir bölüm: biten 1, o anki set oranında, kalanlar 0', () => {
    const list = [ex('Bench', [true, true, true]), ex('Row', [true, false, false, false]), ex('Lateral', [false]), ex('Boş', [])];
    expect(progressSegments(list)).toEqual([1, 0.25, 0, 0]);
  });

  it('geçen süre metni', () => {
    expect(formatElapsed(1450)).toBe('24:10');
    expect(formatElapsed(59)).toBe('0:59');
    expect(formatElapsed(3850)).toBe('1:04:10');
    expect(formatElapsed(-5)).toBe('0:00');
    expect(elapsedAndPercent(1450, 40)).toBe('24:10 · %40');
  });
});

describe('odaktaki set', () => {
  const sets = ex('Bench', [true, false, false]).sets;

  it('seçili yoksa ilk tamamlanmamış', () => {
    expect(focusSetIndex(sets, null)).toBe(1);
  });

  it('seçili set (tamamlanmış da olabilir) öne geçer; silinmişse ilk tamamlanmamış', () => {
    expect(focusSetIndex(sets, sets[0]!.id)).toBe(0);
    expect(focusSetIndex(sets, 'yok')).toBe(1);
  });

  it('hepsi tamamsa null', () => {
    expect(focusSetIndex(ex('Row', [true, true]).sets, null)).toBeNull();
  });

  it('etiket: hareket / set, süperset, biten hareket', () => {
    expect(focusLabel({ exerciseIndex: 1, exerciseCount: 7, setIndex: 1, setCount: 4, superset: null })).toBe(
      'HAREKET 2 / 7 · SET 2 / 4'
    );
    const list = [ex('A', [false], 1), ex('B', [false], 1), ex('C', [false])];
    const pos = focusSupersets(list);
    expect(supersetMemberLabels(pos, 0)).toEqual(['A1', 'A2']);
    expect(supersetMemberLabels(pos, 2)).toEqual([]);
    expect(
      focusLabel({
        exerciseIndex: 0,
        exerciseCount: 3,
        setIndex: 0,
        setCount: 3,
        superset: pos[0]!,
        supersetMembers: supersetMemberLabels(pos, 0),
      })
    ).toBe('SÜPERSET · A1 / A2 · SET 1 / 3');
    expect(focusLabel({ exerciseIndex: 2, exerciseCount: 3, setIndex: null, setCount: 4, superset: null })).toBe(
      'HAREKET 3 / 3 · SET 4 / 4 ✓'
    );
  });
});

describe('sıradaki set / hareket', () => {
  it('aynı harekette set kaldıysa aynı hareketin sıradaki seti', () => {
    const list = [ex('Bench', [true, false, false]), ex('Row', [false, false])];
    const cur = list[0]!.sets[1]!.id;
    expect(nextAfterSet(list, 0, cur)).toEqual({ exerciseIndex: 0, setIndex: 2 });
    expect(nextUpText(list, 0, nextAfterSet(list, 0, cur))).toBe('Set 3 · Bench');
    expect(exerciseAfterSet(list, 0, cur)).toBe(0);
  });

  it('hareketin son seti: sıradaki tamamlanmamış hareket (sonra gelenler önce)', () => {
    const list = [ex('Bench', [true, true, false]), ex('Row', [true, true]), ex('Lateral', [false, false])];
    const cur = list[0]!.sets[2]!.id;
    expect(nextAfterSet(list, 0, cur)).toEqual({ exerciseIndex: 2, setIndex: 0 });
    expect(nextUpText(list, 0, nextAfterSet(list, 0, cur))).toBe('Lateral');
    expect(exerciseAfterSet(list, 0, cur)).toBe(2);
  });

  it('sonra gelenler bittiyse öncekilere döner', () => {
    const list = [ex('Bench', [true, false]), ex('Row', [true, false])];
    const cur = list[1]!.sets[1]!.id;
    expect(nextAfterSet(list, 1, cur)).toEqual({ exerciseIndex: 0, setIndex: 1 });
  });

  it('son set: null, "Son set"; yerinde kalır', () => {
    const list = [ex('Bench', [true, true]), ex('Row', [true, false])];
    const cur = list[1]!.sets[1]!.id;
    expect(nextAfterSet(list, 1, cur)).toBeNull();
    expect(nextUpText(list, 1, null)).toBe('Son set');
    expect(exerciseAfterSet(list, 1, cur)).toBe(1);
  });

  it('süperset: hareketler sırayla gelir (A1 → A2 → A1 …)', () => {
    const list = [ex('Bench', [false, false], 1), ex('Row', [false, false], 1), ex('Lateral', [false])];
    const a1 = list[0]!.sets[0]!.id;
    // A1'in seti → A2
    expect(nextAfterSet(list, 0, a1)).toEqual({ exerciseIndex: 1, setIndex: 0 });
    // A2'nin seti (A1'in 1. seti yapılmış) → yeni tur A1
    list[0]!.sets[0]!.isCompleted = true;
    const a2 = list[1]!.sets[0]!.id;
    expect(nextAfterSet(list, 1, a2)).toEqual({ exerciseIndex: 0, setIndex: 1 });
    expect(exerciseAfterSet(list, 1, a2)).toBe(0);
  });

  it('süpersetin son turu bitince sıradaki hareket', () => {
    const list = [ex('Bench', [true, true], 1), ex('Row', [true, false], 1), ex('Lateral', [false])];
    const last = list[1]!.sets[1]!.id;
    expect(nextAfterSet(list, 1, last)).toEqual({ exerciseIndex: 2, setIndex: 0 });
  });
});

describe('Bitir onayı', () => {
  it('tamamlanmamış set varsa sorulur, sayısıyla', () => {
    expect(finishConfirmation([ex('Bench', [true, false]), ex('Row', [false, false, false])])).toEqual({
      needed: true,
      message: '4 set tamamlanmadı.',
    });
  });

  it('hepsi bittiyse onaysız', () => {
    expect(finishConfirmation([ex('Bench', [true, true])]).needed).toBe(false);
    expect(finishConfirmation([]).needed).toBe(false);
  });
});

describe('değerlerin hazır gelmesi: bu antrenmandaki önceki set → geçen sefer → hedef → boş', () => {
  const s = (isCompleted: boolean, weightKg: number | null, reps: number | null, setType = 'normal') => ({
    isCompleted,
    setType,
    weightKg,
    reps,
  });

  it('Set 1 72,5 kg yapıldıysa Set 2’de 72,5 gelir (geçen seferin önüne geçer)', () => {
    const sets = [s(true, 72.5, 7), s(false, 60, null), s(false, 60, null)];
    expect(
      prefillValues({
        weightKg: 60,
        reps: null,
        earlier: earlierCompletedSet(sets, 1),
        previous: { weightKg: 70, reps: 8 },
        targetWeightKg: 60,
        targetReps: '8-12',
      })
    ).toEqual({ weight: '72.5', reps: '7', weightSource: 'earlier', repsSource: 'earlier' });
  });

  it('önceki tamamlanmış set: en yakını, tamamlanmamışlar ve ısınma atlanır', () => {
    const sets = [s(true, 40, 12, 'warmup'), s(true, 70, 8), s(false, null, null), s(true, 75, 6), s(false, null, null)];
    expect(earlierCompletedSet(sets, 4)).toEqual(sets[3]);
    expect(earlierCompletedSet(sets, 2)).toEqual(sets[1]);
    expect(earlierCompletedSet(sets, 1)).toBeNull(); // ısınmanın değeri asıl sete taşınmaz
    expect(earlierCompletedSet(sets, 0)).toBeNull();
    expect(earlierCompletedSet(sets, 9)).toBeNull();
  });

  it('kullanıcının bu sette yazdığı, önceki setin önüne geçer', () => {
    expect(
      prefillValues({ weightKg: 80, reps: 5, earlier: { weightKg: 72.5, reps: 7 }, targetWeightKg: 60 })
    ).toMatchObject({ weight: '80', reps: '5', weightSource: 'set', repsSource: 'set' });
  });

  it('önceki sette tekrar boşsa tekrar geçen seferden', () => {
    expect(
      prefillValues({ weightKg: null, reps: null, earlier: { weightKg: 50, reps: null }, previous: { weightKg: 45, reps: 10 } })
    ).toMatchObject({ weight: '50', reps: '10', weightSource: 'earlier', repsSource: 'previous' });
  });
});

describe('değerlerin hazır gelmesi: önceki set yokken geçen sefer → hedef → boş', () => {
  it('geçen sefer varsa o (başlangıçta yazılan hedef ağırlığın önüne geçer)', () => {
    expect(
      prefillValues({ weightKg: 60, reps: null, previous: { weightKg: 70, reps: 8 }, targetWeightKg: 60, targetReps: '8-12' })
    ).toEqual({ weight: '70', reps: '8', weightSource: 'previous', repsSource: 'previous' });
  });

  it('geçen sefer yoksa rutindeki hedef (tekrar aralığının alt sınırı)', () => {
    expect(prefillValues({ weightKg: 60, reps: null, previous: null, targetWeightKg: 60, targetReps: '8-12' })).toEqual({
      weight: '60',
      reps: '8',
      weightSource: 'target',
      repsSource: 'target',
    });
    expect(prefillValues({ weightKg: null, reps: null, targetReps: '10' }).reps).toBe('10');
  });

  it('o da yoksa boş', () => {
    expect(prefillValues({ weightKg: null, reps: null, targetReps: 'AMRAP' })).toEqual({
      weight: '',
      reps: '',
      weightSource: 'empty',
      repsSource: 'empty',
    });
  });

  it('kullanıcının bu sette yazdığı değer her zaman geçerli', () => {
    expect(
      prefillValues({ weightKg: 72.5, reps: 6, previous: { weightKg: 70, reps: 8 }, targetWeightKg: 60, targetReps: '8' })
    ).toEqual({ weight: '72.5', reps: '6', weightSource: 'set', repsSource: 'set' });
    // hedef yoksa kayıtlı ağırlık yazılmış sayılır
    expect(prefillValues({ weightKg: 40, reps: null, previous: { weightKg: 70, reps: 8 } }).weight).toBe('40');
  });
});

describe('ayar düğmeleri ve metinler', () => {
  it('kg ±2,5, lbs ±5', () => {
    expect(weightStep('kg')).toBe(2.5);
    expect(weightStep(null)).toBe(2.5);
    expect(weightStep('lbs')).toBe(5);
  });

  it('ağırlık ve tekrar adımı; 0 altı yok', () => {
    expect(stepWeight('70', 2.5)).toBe('72.5');
    expect(stepWeight('72,5', -2.5)).toBe('70');
    expect(stepWeight('', 2.5)).toBe('2.5');
    expect(stepWeight('1', -2.5)).toBe('0');
    expect(stepReps('8', 1)).toBe('9');
    expect(stepReps('0', -1)).toBe('0');
    expect(stepReps('', 1)).toBe('1');
  });

  it('kutular tek öğe olarak okunur', () => {
    expect(weightA11yLabel('70', 'kg')).toBe('Ağırlık: 70 kilogram');
    expect(weightA11yLabel('72.5', 'kg')).toBe('Ağırlık: 72,5 kilogram');
    expect(weightA11yLabel('', 'kg')).toBe('Ağırlık: boş');
    expect(repsA11yLabel('8')).toBe('Tekrar: 8');
    expect(setValueText(70, 8)).toBe('70 × 8');
    expect(setValueText(null, null)).toBe('—');
  });

  it('kilo biçimi virgüllü; şeritte uzun değer boşluksuz (v4.0b 1.6)', () => {
    expect(setValueText(22.5, 10)).toBe('22,5 × 10');
    expect(setValueText('22.5', 10)).toBe('22,5 × 10');
    expect(setValueText('22,5', 10)).toBe('22,5 × 10');
    expect(setChipText(22.5, 10)).toBe('22,5×10');
    expect(setChipText(70, 8)).toBe('70 × 8');
    expect(setChipText(100, 10)).toBe('100×10');
    expect(setChipText(null, null)).toBe('—');
    expect(decimalComma(1.25)).toBe('1,25');
    expect(decimalComma('')).toBe('');
    expect(formatSetSummary(22.5, 8, null)).toBe('22,5kg × 8');
  });
});
