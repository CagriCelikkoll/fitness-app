/**
 * Sistem çubukları (v0.13): durum çubuğu ve Android gezinme çubuğu temayı
 * izler. Saf; bileşenler `useTheme.tsx` ve `DarkSystemBars.tsx`.
 *
 * Android kenardan kenara çiziyor: gezinme çubuğunun kendi rengi yok, altında
 * uygulamanın zemini görünür. 0.12'deki beyaz şerit, sistemin üç tuşlu
 * gezinmede çizdiği yarı saydam "kontrast perdesi"ydi (açık tuş stiliyle
 * beyaz). `app.json`'da `expo-navigation-bar` → `enforceContrast: false`
 * perdeyi kaldırıyor (Android 10+). Android 9'da (Huawei) perde her zaman
 * var; rengi tuş stilinden geliyor: açık tuş → koyu perde. Bu yüzden tuş
 * stili de temaya göre değişir.
 *
 * Stil adları StatusBar'daki gibi içerik rengi: 'light' = açık renkli
 * tuşlar / yazı (koyu zemin için).
 */

import type { ColorScheme } from '@/theme';

export type BarContentStyle = 'light' | 'dark';

/** Temaya göre çubuk içerik rengi */
export function systemBarStyle(scheme: ColorScheme): BarContentStyle {
  return scheme === 'dark' ? 'light' : 'dark';
}

/** Görselli koyu ekranlar (karşılama, kapaklar, rekor): her temada */
export const DARK_SCREEN_BAR_STYLE: BarContentStyle = 'light';
