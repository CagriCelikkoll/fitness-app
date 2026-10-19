/**
 * Alt güvenli alan (v3.6e). Android uygulamayı kenardan kenara çiziyor;
 * alttaki gezinme çubuğunun (3 tuş ya da hareket çizgisi) yüksekliği
 * boşluk olarak bırakılmazsa ekranın altı tuşların altına giriyor.
 *
 * Tek yerden uygulanıyor:
 * - Yığın ekranları: `app/_layout.tsx` her ekranın içerik kabına
 *   `screenBottomInset` kadar alt boşluk veriyor. Ekranlar kendi
 *   alt boşluğunu eklemez (çift boşluk olur; test/safeArea.test.ts tarıyor).
 * - Sekmeler: sekme çubuğu boşluğu kendisi bırakıyor (react-navigation).
 * - Alttan açılan sayfalar (RN `Modal`, ayrı pencere):
 *   `useSheetBottomPadding()` (`src/hooks/useSafeBottom.ts`).
 *
 * Klavye açıkken gezinme çubuğu klavyenin altında kalıyor; boşluk
 * bırakılırsa klavyeyle içerik arasında boş şerit oluşur, o yüzden 0.
 * Android 9 gibi çubuğun pencereyi kesmediği cihazlarda inset zaten 0,
 * görünüm değişmez. Saf; React bilmez.
 */

/** Kendi alt boşluğunu kendisi bırakan yığın rotaları (sekme çubuğu) */
export const SELF_INSET_ROUTES: readonly string[] = ['(tabs)'];

/** Alttan açılan sayfanın taban boşluğu (eski `pb-10`) */
export const SHEET_BASE_PADDING = 40;

function cleanInset(inset: number): number {
  return Number.isFinite(inset) && inset > 0 ? inset : 0;
}

/** Yığın ekranının içerik kabına verilecek alt boşluk */
export function screenBottomInset(route: string, inset: number, keyboardVisible: boolean): number {
  if (keyboardVisible || SELF_INSET_ROUTES.includes(route)) return 0;
  return cleanInset(inset);
}

/** Alttan açılan sayfa (Modal) için alt boşluk: taban + gezinme çubuğu */
export function sheetBottomPadding(inset: number, keyboardVisible: boolean, base: number = SHEET_BASE_PADDING): number {
  return base + (keyboardVisible ? 0 : cleanInset(inset));
}
