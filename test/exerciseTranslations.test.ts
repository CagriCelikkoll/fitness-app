import { describe, expect, it } from 'vitest';

import {
  getInstructionsTr,
  resolveInstructions,
  type TranslationFile,
} from '@/lib/exerciseTranslations';

interface SourceExercise {
  id: string;
  instructions: string[];
}

const source = require('../assets/seed/exercises.json') as SourceExercise[];
const translations =
  require('../assets/seed/exercises.tr.json') as TranslationFile;

const sourceById = new Map(source.map((e) => [e.id, e]));
const entries = Object.entries(translations);

describe('exercises.tr.json geçerliliği', () => {
  it('her anahtar exercises.json\'da var', () => {
    const unknown = entries
      .map(([id]) => id)
      .filter((id) => !sourceById.has(id));
    expect(unknown).toEqual([]);
  });

  it('her kaydın adım sayısı orijinalle aynı', () => {
    const mismatched = entries
      .filter(([id, t]) => {
        const original = sourceById.get(id);
        return original && t.instructions.length !== original.instructions.length;
      })
      .map(([id]) => id);
    expect(mismatched).toEqual([]);
  });

  it('boş adım yok (kaynakta da boş olanlar hariç)', () => {
    const withEmpty = entries
      .filter(([id, t]) => {
        const original = sourceById.get(id);
        return t.instructions.some(
          (step, i) =>
            typeof step !== 'string' ||
            (step.trim() === '' && original?.instructions[i]?.trim() !== '')
        );
      })
      .map(([id]) => id);
    expect(withEmpty).toEqual([]);
  });

  it('anahtarlar id\'ye göre sıralı', () => {
    const ids = entries.map(([id]) => id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('exercises.tr.json kapsamı', () => {
  // Toplu çeviri bitince açılacak (spec Aşama 5)
  it.skip('talimatı olan her hareketin çevirisi var', () => {
    const missing = source
      .filter((e) => e.instructions.some((s) => s.trim() !== ''))
      .filter((e) => !Object.prototype.hasOwnProperty.call(translations, e.id))
      .map((e) => e.id);
    expect(missing).toEqual([]);
  });
});

describe('resolveInstructions', () => {
  const translatedId = 'Barbell_Bench_Press_-_Medium_Grip';
  const originalJson = JSON.stringify(sourceById.get(translatedId)!.instructions);

  it('çeviri varsa Türkçe ve isTranslated: true', () => {
    const result = resolveInstructions(translatedId, originalJson);
    expect(result.isTranslated).toBe(true);
    expect(result.steps).toEqual(getInstructionsTr(translatedId));
  });

  it('çeviri yoksa orijinal ve isTranslated: false', () => {
    const result = resolveInstructions('ozel-hareket', '["Adım 1","Adım 2"]');
    expect(result).toEqual({ steps: ['Adım 1', 'Adım 2'], isTranslated: false });
  });

  it('bozuk ya da boş JSON\'da çökmüyor', () => {
    expect(resolveInstructions('ozel-hareket', '{bozuk').steps).toEqual([]);
    expect(resolveInstructions('ozel-hareket', '{"a":1}').steps).toEqual([]);
    expect(resolveInstructions('ozel-hareket', null).steps).toEqual([]);
  });

  it('Object prototipindeki adlar çeviri sayılmıyor', () => {
    expect(getInstructionsTr('constructor')).toBeNull();
    expect(getInstructionsTr('toString')).toBeNull();
  });
});
