/**
 * Dinlenme bitiş sesi — saf karar. Çalma `restNative.ts`'te.
 */

/**
 * Sayaç bu kadardan daha önce bitmişse ses çalınmaz. Uygulama arka
 * plandayken biten dinlenmede ekrana dönünce (sayaç "tamamlandı"ya
 * geçerken) gecikmiş bir bip çalmasın; bildirim zaten gelmişti.
 * −15 ile hemen biten sayaç (−1 sn içinde) normal bitiş sayılıyor.
 */
export const MAX_REST_SOUND_LATENESS_MS = 2000;

/**
 * Ses yalnızca ön planda, ayar açıkken ve bitiş taze ise çalar. Arka
 * planda bitişi bildirim haber veriyor.
 *
 * @param remainingMs Bitişe kalan süre; sayaç bitmişse sıfır ya da negatif
 */
export function shouldPlayRestSound({
  enabled,
  foreground,
  remainingMs,
}: {
  enabled: boolean;
  foreground: boolean;
  remainingMs: number;
}): boolean {
  return enabled && foreground && remainingMs > -MAX_REST_SOUND_LATENESS_MS;
}
