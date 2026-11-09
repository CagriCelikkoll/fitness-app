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

/**
 * Başlıksız ekranın üst boşluğu. Android'de inset 0 gelirse (eski cihazlar)
 * durum çubuğunun kendi yüksekliği: başlık çubuğun altına girmesin.
 */
export function screenTopInset(inset: number, statusBarHeight: number | undefined): number {
  return Math.max(cleanInset(inset), cleanInset(statusBarHeight ?? 0));
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

/**
 * Havada duran alt menü (v4.0a Bölüm 5): kenarlardan 16, alttan gezinme
 * çubuğu + 22, yükseklik 64. Sekme ekranlarının içerik alanı menünün
 * üstünde biter (`sceneStyle.paddingBottom` = `scenePadding`); böylece
 * listeler ve yüzen "+" düğmeleri menünün altında kalmaz. Klavye açıkken
 * menü gizli, boşluk 0.
 */
export const TAB_BAR = { side: 16, gap: 22, height: 64, radius: 22 } as const;

export function floatingTabBarLayout(inset: number, keyboardVisible: boolean): { bottom: number; scenePadding: number } {
  const bottom = cleanInset(inset) + TAB_BAR.gap;
  return { bottom, scenePadding: keyboardVisible ? 0 : bottom + TAB_BAR.height + 8 };
}

/**
 * Etiketler 12 px'te tek satıra sığıyor mu? Sekme başına genişlik, en uzun
 * etiketin yaklaşık genişliği (Archivo SemiBold 12 px ≈ 6,2 px / harf,
 * ~0,52 em) ve 2 px pay. Tahmin. Bu yüzden menüde 5 sekme var
 * (`src/lib/tabRoutes.ts`): 6 sekmede "Hareketler" 360 dp telefonda sığmıyordu.
 */
export function tabLabelsFit(screenWidth: number, labels: readonly string[]): boolean {
  if (labels.length === 0) return true;
  const perTab = (screenWidth - TAB_BAR.side * 2) / labels.length;
  const longest = Math.max(...labels.map((l) => l.length));
  return longest * 6.2 + 2 <= perTab;
}
