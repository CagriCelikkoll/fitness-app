/**
 * Süperset: iki ya da daha fazla hareketi aralarında dinlenmeden arka
 * arkaya yapmak. `routine_exercises.supersetGroup` ve
 * `session_exercises.supersetGroup` aynı gruptaki hareketlere aynı numarayı
 * verir; null süperset değil demek.
 *
 * Grup her zaman ARDIŞIK hareketlerden oluşur. Kaydetmeden önce
 * `normalizeSupersetGroups` ile numaralar düzeltiliyor; okuma tarafındaki
 * fonksiyonlar da yalnızca ardışık aynı numaraları grup sayıyor, eski ya
 * da bozuk veri ekranı şaşırtmasın.
 */

type Group = number | null;

/**
 * - Ardışık aynı numaralar bir grup
 * - Tek üyeli grup → null
 * - Gruplar sırayla 1, 2, 3... diye yeniden numaralanır
 */
export function normalizeSupersetGroups(groups: Group[]): Group[] {
  const result: Group[] = new Array(groups.length).fill(null);
  let next = 1;
  let i = 0;
  while (i < groups.length) {
    const g = groups[i];
    let end = i + 1;
    if (g != null) {
      while (end < groups.length && groups[end] === g) end += 1;
    }
    if (g != null && end - i >= 2) {
      for (let k = i; k < end; k += 1) result[k] = next;
      next += 1;
    }
    i = end;
  }
  return result;
}

/** Normalleştirilmiş gruplar arasında kullanılmayan bir numara */
function freshGroup(groups: Group[]): number {
  return groups.reduce<number>((max, g) => (g != null && g > max ? g : max), 0) + 1;
}

/**
 * `index` ile `index + 1`'i aynı süperset grubuna bağlar. İkisi farklı
 * gruplardaysa gruplar birleşir.
 */
export function linkWithNext(groups: Group[], index: number): Group[] {
  if (index < 0 || index + 1 >= groups.length) return normalizeSupersetGroups(groups);
  const a = groups[index];
  const b = groups[index + 1];
  const target = a ?? b ?? freshGroup(groups);
  const result = groups.map((g, i) => {
    if (i === index || i === index + 1) return target;
    // Sağdaki grubun diğer üyeleri de birleşen gruba geçsin
    if (b != null && b !== target && g === b) return target;
    return g;
  });
  return normalizeSupersetGroups(result);
}

/** `index` ile `index + 1` arasındaki bağı koparır ("Ayır") */
export function unlinkAfter(groups: Group[], index: number): Group[] {
  const normalized = normalizeSupersetGroups(groups);
  const g = normalized[index];
  if (g == null || normalized[index + 1] !== g) return normalized;
  const split = freshGroup(normalized);
  const result = normalized.map((value, i) => (i > index && value === g ? split : value));
  return normalizeSupersetGroups(result);
}

/** `index` ve `index + 1` aynı süperset grubunda mı (aralarındaki düğme "Ayır" mı) */
export function isLinkedWithNext(groups: Group[], index: number): boolean {
  const normalized = normalizeSupersetGroups(groups);
  return normalized[index] != null && normalized[index] === normalized[index + 1];
}

interface Grouped {
  supersetGroup: Group;
}

/**
 * Yukarı/aşağı taşıma: taşınan hareket grubundan çıkar, sonra yer
 * değiştirir. Grubu blok halinde taşımıyoruz — basit ve öngörülebilir.
 */
export function moveAndDetach<T extends Grouped>(
  items: T[],
  index: number,
  direction: -1 | 1
): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = items.map((item, i) =>
    i === index ? { ...item, supersetGroup: null } : item
  );
  [next[index], next[target]] = [next[target], next[index]];
  return applyGroups(next, normalizeSupersetGroups(next.map((i) => i.supersetGroup)));
}

/** Silme: kalanlar normalleştirilir (tek kalan üye otomatik null) */
export function removeAndNormalize<T extends Grouped>(items: T[], index: number): T[] {
  const rest = items.filter((_, i) => i !== index);
  return applyGroups(rest, normalizeSupersetGroups(rest.map((i) => i.supersetGroup)));
}

/** Grup dizisini öğelere yazar; değişmeyen öğenin referansı korunur */
export function applyGroups<T extends Grouped>(items: T[], groups: Group[]): T[] {
  return items.map((item, i) =>
    item.supersetGroup === groups[i] ? item : { ...item, supersetGroup: groups[i] }
  );
}

export interface SupersetPosition {
  /** "A", "B" ... (grubun sırası) */
  letter: string;
  /** 1'den başlayan üye sırası */
  position: number;
  /** "A1" */
  label: string;
  /** Grubun ilk ve son indeksi (dahil) */
  start: number;
  end: number;
  /** Grubun son üyesi mi (dinlenme bu üyeden sonra) */
  isLast: boolean;
}

/** Grup harfi: 0 → A, 25 → Z, 26 → AA */
function groupLetter(n: number): string {
  let s = '';
  let x = n;
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

/** Her hareketin süperset konumu; süperset değilse null */
export function supersetPositions(groups: Group[]): (SupersetPosition | null)[] {
  const normalized = normalizeSupersetGroups(groups);
  const result: (SupersetPosition | null)[] = new Array(groups.length).fill(null);
  let i = 0;
  while (i < normalized.length) {
    const g = normalized[i];
    if (g == null) {
      i += 1;
      continue;
    }
    let end = i;
    while (end + 1 < normalized.length && normalized[end + 1] === g) end += 1;
    const letter = groupLetter(g - 1);
    for (let k = i; k <= end; k += 1) {
      const position = k - i + 1;
      result[k] = {
        letter,
        position,
        label: `${letter}${position}`,
        start: i,
        end,
        isLast: k === end,
      };
    }
    i = end + 1;
  }
  return result;
}

// ============================================================================
// Aktif antrenman: set tamamlanınca dinlenme kararı
// ============================================================================

export interface SessionExerciseState {
  name: string;
  supersetGroup: Group;
  sets: { id: string; isCompleted: boolean }[];
}

export interface AfterSetContext {
  /** Seanstaki hareketler, sırayla */
  exercises: SessionExerciseState[];
  /** Seti tamamlanan hareketin indeksi */
  currentIndex: number;
  /**
   * Az önce tamamlanan set. Veri henüz tazelenmemiş olabilir; bu set her
   * durumda tamamlanmış sayılır.
   */
  completedSetId: string;
}

export interface AfterSetResult {
  startRest: boolean;
  next: { exerciseIndex: number; label: string } | null;
}

function hasIncompleteSet(ex: SessionExerciseState, completedSetId: string): boolean {
  return ex.sets.some((s) => !s.isCompleted && s.id !== completedSetId);
}

/**
 * Set tamamlanınca dinlenme başlasın mı, sıradaki hareket hangisi.
 *
 * - Süperset değil → dinlenme var, sıradaki yok (v1.9 öncesiyle aynı)
 * - Süperset, gruptaki SONRAKİ üyelerden birinde tamamlanmamış set var →
 *   dinlenme yok, sıradaki o üye
 * - Yoksa (turun son üyesi) → dinlenme var; ÖNCEKİ üyelerden birinde
 *   tamamlanmamış set varsa sıradaki tur o üyeden başlar
 *
 * Set sayıları farklı üyeleri de karşılar: A 3, B 4 set ise 4. turda
 * yalnızca B kalır ve normal dinlenmeyle devam eder.
 */
export function afterSetCompleted(context: AfterSetContext): AfterSetResult {
  const { exercises, currentIndex, completedSetId } = context;
  const position = supersetPositions(exercises.map((e) => e.supersetGroup))[currentIndex];
  if (!position) return { startRest: true, next: null };

  for (let i = currentIndex + 1; i <= position.end; i += 1) {
    if (hasIncompleteSet(exercises[i], completedSetId)) {
      return {
        startRest: false,
        next: { exerciseIndex: i, label: `Sıradaki: ${exercises[i].name}` },
      };
    }
  }

  for (let i = position.start; i < currentIndex; i += 1) {
    if (hasIncompleteSet(exercises[i], completedSetId)) {
      return {
        startRest: true,
        next: { exerciseIndex: i, label: `Sıradaki tur: ${exercises[i].name}` },
      };
    }
  }

  return { startRest: true, next: null };
}
