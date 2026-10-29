/**
 * Egzersiz seçici: arama/filtre değişince listeden çıkan seçim
 * kaybolmamalı, onay seçim sırasıyla dönmeli.
 */

import { describe, expect, it } from 'vitest';

import {
  addSelectionLabel,
  discardSelectionMessage,
  missingSelectionIds,
  pendingSelectionCount,
  pickerBackAction,
  selectionOrder,
  resolveSelection,
  selectionFromIds,
  toggleInSelection,
  type PickerSelection,
} from '@/lib/pickerSelection';

interface Item {
  id: string;
  name: string;
}

const bench: Item = { id: 'bench', name: 'Bench Press' };
const squat: Item = { id: 'squat', name: 'Squat' };
const row: Item = { id: 'row', name: 'Row' };

function pick(items: Item[], singleSelect = false): PickerSelection<Item> {
  return items.reduce(
    (sel, item) => toggleInSelection(sel, item, singleSelect),
    new Map() as PickerSelection<Item>
  );
}

describe('toggleInSelection', () => {
  it('seçim sırası korunuyor', () => {
    const sel = pick([squat, bench, row]);
    expect(resolveSelection(sel).map((i) => i.id)).toEqual([
      'squat',
      'bench',
      'row',
    ]);
  });

  it('seçili olan çıkarılıyor, yeniden seçilince sona ekleniyor', () => {
    let sel = pick([bench, squat, row]);
    sel = toggleInSelection(sel, bench, false);
    expect([...sel.keys()]).toEqual(['squat', 'row']);
    sel = toggleInSelection(sel, bench, false);
    expect([...sel.keys()]).toEqual(['squat', 'row', 'bench']);
  });

  it('önceki durumu değiştirmiyor (yeni Map)', () => {
    const before = pick([bench]);
    const after = toggleInSelection(before, squat, false);
    expect(before.size).toBe(1);
    expect(after.size).toBe(2);
  });

  it('tek seçim modunda yeni seçim öncekinin yerini alıyor', () => {
    const sel = pick([bench, squat], true);
    expect([...sel.keys()]).toEqual(['squat']);
    expect(toggleInSelection(sel, squat, true).size).toBe(0);
  });
});

describe('resolveSelection', () => {
  it('listede artık görünmeyen seçimler de dönüyor (nesne seçimde tutuluyor)', () => {
    // bench seçildi, sonra arama değişti; o anki liste yalnızca squat içeriyor.
    // Liste çözümlemeye hiç girmiyor — seçim kendi nesnelerini taşıyor.
    const sel = pick([bench, squat]);
    expect(resolveSelection(sel)).toEqual([bench, squat]);
  });

  it('dışarıdan verilen id\'ler yüklenen nesnelerle tamamlanıyor, sıra korunuyor', () => {
    let sel = selectionFromIds<Item>(['row', 'bench']);
    sel = toggleInSelection(sel, squat, false);

    expect(missingSelectionIds(sel)).toEqual(['row', 'bench']);
    expect(resolveSelection(sel, [bench, row]).map((i) => i.id)).toEqual([
      'row',
      'bench',
      'squat',
    ]);
  });

  it('bulunamayan (silinmiş) id atlanıyor', () => {
    const sel = selectionFromIds<Item>(['gone', 'bench']);
    expect(resolveSelection(sel, [bench])).toEqual([bench]);
  });
});

describe('seçim sırası ve geri onayı (v3.8)', () => {
  it('sıra numarası seçim sırasıyla; çıkarılınca sonrakiler kayar', () => {
    let sel = pick([squat, bench, row]);
    expect([...selectionOrder(sel)]).toEqual([
      ['squat', 1],
      ['bench', 2],
      ['row', 3],
    ]);
    sel = toggleInSelection(sel, bench, false);
    expect([...selectionOrder(sel)]).toEqual([
      ['squat', 1],
      ['row', 2],
    ]);
    // onay bu sırayla
    expect(resolveSelection(sel).map((i) => i.id)).toEqual(['squat', 'row']);
  });

  it('seçim yokken geri hemen kapatır', () => {
    expect(pickerBackAction(new Map())).toBe('close');
    // seçip geri bırakınca da
    expect(pickerBackAction(toggleInSelection(pick([bench]), bench, false))).toBe('close');
  });

  it('seçim varken geri onay sorar', () => {
    expect(pickerBackAction(pick([bench]))).toBe('confirm');
    expect(pendingSelectionCount(pick([bench, squat, row]))).toBe(3);
  });

  it('açılışta zaten seçili olanlar eklenmemiş sayılmaz', () => {
    const initial = selectionFromIds<Item>(['bench']);
    expect(pickerBackAction(initial, ['bench'])).toBe('close');
    const more = toggleInSelection(initial, squat, false);
    expect(pendingSelectionCount(more, ['bench'])).toBe(1);
    expect(pickerBackAction(more, ['bench'])).toBe('confirm');
  });

  it('metinler', () => {
    expect(addSelectionLabel(6)).toBe('6 egzersizi ekle');
    expect(discardSelectionMessage(6)).toBe('Seçtiğin 6 egzersiz eklenmeden çıkılsın mı?');
  });
});
