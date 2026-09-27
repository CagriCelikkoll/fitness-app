/**
 * Egzersiz talimatlarının Türkçe çevirileri.
 *
 * Çeviriler veritabanında değil, gömülü `assets/seed/exercises.tr.json`
 * dosyasında: mevcut kurulumların veritabanı İngilizce talimatlarla dolu
 * ve şemaya sütun eklemek OTA ile giden bir migration gerektirirdi.
 * Anahtar `exercises.json`'daki `id`; çevirisi olmayan hareket (özel
 * hareketler, kardiyo modları) veritabanındaki talimatla gösteriliyor.
 *
 * `require` ile okunuyor, `import` ile değil — bkz. `src/db/seed.ts`.
 */

export type TranslationFile = Record<string, { instructions: string[] }>;

const translations =
  require('../../assets/seed/exercises.tr.json') as TranslationFile;

/** Türkçe talimat varsa döndürür, yoksa null */
export function getInstructionsTr(exerciseId: string): string[] | null {
  if (!Object.prototype.hasOwnProperty.call(translations, exerciseId)) {
    return null;
  }
  return translations[exerciseId].instructions;
}

/** Veritabanındaki JSON talimat dizisi; bozuksa boş dizi */
export function parseInstructions(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Talimatları göstermek için: Türkçe varsa o, yoksa orijinal */
export function resolveInstructions(
  exerciseId: string,
  originalJson: string | null
): { steps: string[]; isTranslated: boolean } {
  const tr = getInstructionsTr(exerciseId);
  if (tr) return { steps: tr, isTranslated: true };
  return { steps: parseInstructions(originalJson), isTranslated: false };
}
