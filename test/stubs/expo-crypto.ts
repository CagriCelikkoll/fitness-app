/**
 * `expo-crypto` yerine geçen test stub'ı (vitest.config.ts'te alias'lanır).
 *
 * `src/lib/id.ts` yalnızca `randomUUID` kullanıyor. Testlerde kriptografik
 * rastgelelik değil, çakışmayan ve tekrarlanabilir id gerekiyor: sayaç
 * tabanlı üretim hata ayıklamayı da kolaylaştırıyor (id'ler okunabilir).
 */

let counter = 0;

export function randomUUID(): string {
  counter += 1;
  const hex = counter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/** Testler arasında id'leri sıfırlamak isteyen olursa */
export function __resetUuidCounter(): void {
  counter = 0;
}
