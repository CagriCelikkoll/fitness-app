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
 * Dosya ~1 MB; açılışta değil, ilk talimat gösteriminde yükleniyor ve
 * sonrası için önbellekte tutuluyor.
 */

export type TranslationFile = Record<string, { instructions: string[] }>;

let translations: TranslationFile | null = null;

function loadTranslations(): TranslationFile {
  if (!translations) {
    translations =
      require('../../assets/seed/exercises.tr.json') as TranslationFile;
  }
  return translations;
}

/** Türkçe talimat varsa döndürür, yoksa null */
export function getInstructionsTr(exerciseId: string): string[] | null {
  const all = loadTranslations();
  if (!Object.prototype.hasOwnProperty.call(all, exerciseId)) {
    return null;
  }
  return all[exerciseId].instructions;
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
