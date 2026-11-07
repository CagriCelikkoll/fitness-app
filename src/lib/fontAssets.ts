import { FONT_FAMILIES } from './typography';

/**
 * Archivo dosyaları (v4.0a). `app/_layout.tsx` `useFonts` ile yükler;
 * dosyalar JS paketine girer, OTA ile gider (native ayar yok).
 * Testte kullanılmaz (require .ttf).
 */
export const FONT_ASSETS = {
  [FONT_FAMILIES.display]: require('../../assets/fonts/Archivo-Expanded-ExtraBold.ttf'),
  [FONT_FAMILIES.regular]: require('../../assets/fonts/Archivo-Regular.ttf'),
  [FONT_FAMILIES.semibold]: require('../../assets/fonts/Archivo-SemiBold.ttf'),
  [FONT_FAMILIES.bold]: require('../../assets/fonts/Archivo-Bold.ttf'),
};
