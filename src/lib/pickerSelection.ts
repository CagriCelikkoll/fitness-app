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

/**
 * Seçim sırası numaraları (1, 2, 3…), id → sıra. Listede rozet olarak
 * gösteriliyor; onay da bu sırayla dönüyor (`resolveSelection`).
 */
export function selectionOrder<T extends { id: string }>(
  selection: PickerSelection<T>
): Map<string, number> {
  return new Map([...selection.keys()].map((id, i) => [id, i + 1]));
}

/**
 * Henüz eklenmemiş seçimlerin sayısı: açılışta zaten seçili gelenler
 * (`initiallySelectedIds`) sayılmaz.
 */
export function pendingSelectionCount<T extends { id: string }>(
  selection: PickerSelection<T>,
  initiallySelectedIds: readonly string[] = []
): number {
  const initial = new Set(initiallySelectedIds);
  let count = 0;
  for (const id of selection.keys()) if (!initial.has(id)) count++;
  return count;
}

/**
 * Geri (donanım tuşu, hareket, üstteki kapat) ne yapsın (v3.8): eklenmemiş
 * seçim varsa onay sor ("Seçimler eklenmedi"), yoksa hemen kapat.
 */
export function pickerBackAction<T extends { id: string }>(
  selection: PickerSelection<T>,
  initiallySelectedIds: readonly string[] = []
): 'confirm' | 'close' {
  return pendingSelectionCount(selection, initiallySelectedIds) > 0 ? 'confirm' : 'close';
}

/** Alttaki sabit düğme: "6 egzersizi ekle" */
export function addSelectionLabel(count: number): string {
  return `${count} egzersizi ekle`;
}

/** Geri onayının metni */
export function discardSelectionMessage(count: number): string {
  return `Seçtiğin ${count} egzersiz eklenmeden çıkılsın mı?`;
}
