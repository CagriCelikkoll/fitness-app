/**
 * Egzersiz seçicinin seçim durumu.
 *
 * Seçimler nesneyle birlikte tutuluyor: arama/filtre değişip seçili
 * hareket listeden çıksa da onayda eklenebilsin. Map ekleme sırasını
 * koruduğu için onay, kullanıcının seçtiği sırayla dönüyor.
 *
 * Değer null: id biliniyor ama nesne henüz yok (dışarıdan verilen
 * `initiallySelectedIds`); onayda veritabanından tamamlanır.
 */

export type PickerSelection<T extends { id: string }> = Map<string, T | null>;

export function selectionFromIds<T extends { id: string }>(
  ids: readonly string[]
): PickerSelection<T> {
  return new Map(ids.map((id) => [id, null]));
}

/**
 * Seçiliyse çıkarır, değilse sona ekler. Tek seçim modunda yeni seçim
 * öncekilerin yerini alır.
 */
export function toggleInSelection<T extends { id: string }>(
  prev: PickerSelection<T>,
  item: T,
  singleSelect: boolean
): PickerSelection<T> {
  if (prev.has(item.id)) {
    const next = new Map(singleSelect ? [] : prev);
    next.delete(item.id);
    return next;
  }
  const next: PickerSelection<T> = singleSelect ? new Map() : new Map(prev);
  next.set(item.id, item);
  return next;
}

/** Nesnesi henüz olmayan seçimlerin id'leri */
export function missingSelectionIds<T extends { id: string }>(
  selection: PickerSelection<T>
): string[] {
  return [...selection].filter(([, item]) => item == null).map(([id]) => id);
}

/**
 * Seçim sırasıyla nesne listesi. Eksikler `loaded`'dan tamamlanır;
 * orada da yoksa (silinmiş hareket) atlanır.
 */
export function resolveSelection<T extends { id: string }>(
  selection: PickerSelection<T>,
  loaded: readonly T[] = []
): T[] {
  const byId = new Map(loaded.map((item) => [item.id, item]));
  const result: T[] = [];
  for (const [id, item] of selection) {
    const resolved = item ?? byId.get(id);
    if (resolved) result.push(resolved);
  }
  return result;
}
