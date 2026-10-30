/**
 * Egzersiz kataloğu (v3.8): core / extra, Türkçe ad ve eş anlamlılar.
 *
 * Veritabanında değil, gömülü `assets/seed/exercise-catalog.json`'da
 * (bkz. `exerciseTranslations.ts`): mevcut kurulumlara OTA ile gelir,
 * şemaya, eşitlemeye ve yedeğe sütun eklenmez. Anahtar hazır egzersizin
 * değişmez kimliği; dosyada olmayan hazır hareket extra. Kullanıcının
 * kendi hareketleri ve rutininde / geçmişinde olanlar core gibi davranır.
 *
 * Arama SQL'de değil burada: Türkçe ad ve eş anlamlılar veritabanında yok.
 * Kelime kelime eşleşir, büyük-küçük harf ve Türkçe karakter farkı yok.
 * Liste: `docs/egzersiz-core-onerisi.md` (onaylı, 29.10.2026).
 */

export type ExerciseTier = 'core' | 'extra';

export interface CatalogEntry {
  tier: ExerciseTier;
  /** Ekranda ana ad; İngilizce ad altında küçük */
  tr: string;
  aliases?: string[];
}

export type CatalogFile = Record<string, CatalogEntry>;

// `require`: bkz. src/db/seed.ts. Dosya küçük (~180 kayıt) ve ad her
// listede gerektiği için modül yüklenirken okunuyor.
const CATALOG = require('../../assets/seed/exercise-catalog.json') as CatalogFile;

/** Adı gösterilecek egzersizin kullandığımız alanları */
export interface NamedExercise {
  id: string;
  name: string;
  nameTr?: string | null;
}

export interface ListExercise extends NamedExercise {
  category: string;
  isCustom: boolean;
}

export function catalogEntry(id: string): CatalogEntry | null {
  return Object.prototype.hasOwnProperty.call(CATALOG, id) ? CATALOG[id]! : null;
}

/** Core hareketlerin kimlikleri (katalog dosyası) */
export function coreExerciseIds(): string[] {
  return Object.keys(CATALOG).filter((id) => CATALOG[id]!.tier === 'core');
}

/** Ana ad: katalogdaki Türkçe ad, yoksa veritabanındaki Türkçe ad, yoksa ad */
export function exerciseDisplayName(e: NamedExercise): string {
  return catalogEntry(e.id)?.tr ?? e.nameTr ?? e.name;
}

/** Ana adın altında küçük gösterilen özgün (İngilizce) ad; aynıysa null */
export function exerciseOriginalName(e: NamedExercise): string | null {
  const display = exerciseDisplayName(e);
  return normalizeForSearch(display) === normalizeForSearch(e.name) ? null : e.name;
}

/**
 * Varsayılan listede görünür mü: katalogda core, kullanıcının kendi
 * hareketi ya da rutininde / geçmişinde olan (`usedIds`).
 */
export function isCoreFor(
  e: Pick<ListExercise, 'id' | 'isCustom'>,
  usedIds: ReadonlySet<string>
): boolean {
  return e.isCustom || usedIds.has(e.id) || catalogEntry(e.id)?.tier === 'core';
}

// ============================================================================
// Arama
// ============================================================================

const TR_FOLD: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c' };

/**
 * Küçük harf, Türkçe karakterler Latin karşılığına (ı/i, ş/s, ğ/g, ü/u,
 * ö/o, ç/c), noktalama boşluğa. "İ".toLowerCase() "i̇" (birleşik nokta)
 * verdiği için aksanlar ayrıca siliniyor.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ışğüöç]/g, (c) => TR_FOLD[c]!)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function searchTokens(term: string): string[] {
  const normalized = normalizeForSearch(term);
  return normalized ? normalized.split(' ') : [];
}

interface SearchFields {
  display: string;
  names: string[];
  aliases: string[];
  all: string;
}

const fieldsCache = new Map<string, SearchFields>();

function searchFields(e: NamedExercise): SearchFields {
  // Özel hareketin adı değişebilir; anahtar ada da bağlı
  const key = `${e.id}\u0000${e.name}\u0000${e.nameTr ?? ''}`;
  let fields = fieldsCache.get(key);
  if (!fields) {
    const entry = catalogEntry(e.id);
    const display = normalizeForSearch(exerciseDisplayName(e));
    const names = [display, normalizeForSearch(e.name)];
    if (e.nameTr) names.push(normalizeForSearch(e.nameTr));
    const aliases = (entry?.aliases ?? []).map(normalizeForSearch);
    fields = { display, names, aliases, all: [...names, ...aliases].join(' | ') };
    fieldsCache.set(key, fields);
  }
  return fields;
}

/**
 * Eşleşme derecesi (küçük daha iyi), eşleşmezse null:
 * 0 ana ad aramayla başlıyor · 1 arama bir adda bütün olarak geçiyor ·
 * 2 bir eş anlamlıda bütün olarak geçiyor · 3 her kelime bir yerde geçiyor.
 */
export function searchRank(e: NamedExercise, tokens: string[]): number | null {
  if (tokens.length === 0) return 0;
  const f = searchFields(e);
  const phrase = tokens.join(' ');
  if (f.display.startsWith(phrase)) return 0;
  if (f.names.some((n) => n.includes(phrase))) return 1;
  if (f.aliases.some((a) => a.includes(phrase))) return 2;
  return tokens.every((t) => f.all.includes(t)) ? 3 : null;
}

// ============================================================================
// Liste
// ============================================================================

let collator: Intl.Collator | null = null;

function compareNames(a: string, b: string): number {
  collator ??= new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
  return collator.compare(a, b);
}

export interface PartitionOptions {
  search: string;
  /** Kullanıcının rutininde / geçmişinde olan (ve seçicide seçili) kimlikler */
  usedIds: ReadonlySet<string>;
  /** Bölge filtresinde güç hareketleri önce */
  strengthFirst?: boolean;
}

/**
 * Aramayı uygular, core ve extra'yı ayırır ve sıralar: aramada eşleşme
 * derecesi, sonra (bölgede) güç hareketleri önce, sonra Türkçe ana ada göre.
 */
export function partitionExercises<T extends ListExercise>(
  rows: readonly T[],
  { search, usedIds, strengthFirst = false }: PartitionOptions
): { core: T[]; extra: T[] } {
  const tokens = searchTokens(search);
  const ranked: { e: T; rank: number; name: string }[] = [];
  for (const e of rows) {
    const rank = searchRank(e, tokens);
    if (rank != null) ranked.push({ e, rank, name: exerciseDisplayName(e) });
  }
  const group = (e: T) => (strengthFirst && e.category !== 'strength' ? 1 : 0);
  ranked.sort(
    (a, b) => a.rank - b.rank || group(a.e) - group(b.e) || compareNames(a.name, b.name)
  );
  const core: T[] = [];
  const extra: T[] = [];
  for (const r of ranked) (isCoreFor(r.e, usedIds) ? core : extra).push(r.e);
  return { core, extra };
}

export type ExerciseListItem<T> =
  | { kind: 'exercise'; exercise: T }
  /** Aramada ya da açılınca extra sonuçların başlığı */
  | { kind: 'otherHeader' }
  /** "Diğer egzersizleri göster (N)" */
  | { kind: 'showOther'; count: number };

/**
 * Ekrandaki liste: önce core. Extra aramada hep "Diğer" başlığıyla altta;
 * aramasız listede en altta "Diğer egzersizleri göster (N)", açılınca
 * başlıkla. Filtrede hiç core yoksa (ör. Esneme) extra doğrudan gösterilir.
 */
export function buildExerciseListItems<T>(
  { core, extra }: { core: T[]; extra: T[] },
  { searching, showExtra }: { searching: boolean; showExtra: boolean }
): ExerciseListItem<T>[] {
  const items: ExerciseListItem<T>[] = core.map((exercise) => ({ kind: 'exercise', exercise }));
  if (extra.length === 0) return items;
  const extraItems = extra.map((exercise): ExerciseListItem<T> => ({ kind: 'exercise', exercise }));
  if (core.length === 0) return extraItems;
  if (searching || showExtra) return [...items, { kind: 'otherHeader' }, ...extraItems];
  return [...items, { kind: 'showOther', count: extra.length }];
}

export const OTHER_EXERCISES_TITLE = 'Diğer';

export function showOtherLabel(count: number): string {
  return `Diğer egzersizleri göster (${count})`;
}
