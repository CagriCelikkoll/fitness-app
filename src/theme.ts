/**
 * Uygulamanın renk paleti — tek doğruluk kaynağı.
 *
 * NativeWind sınıfları (`bg-bg-surface`, `text-muted` …) tailwind.config.js
 * üzerinden, satır içi renk isteyen yerler (lucide ikonları, navigasyon
 * seçenekleri, SVG, Switch) doğrudan buradan okur.
 *
 * tailwind.config.js CommonJS olduğu için bu dosyayı içe aktaramıyor;
 * değerleri orada da aynı tut.
 */
export const COLORS = {
  bg: '#0A0A0B', // zemin, neredeyse siyah
  surface: '#141416', // kart
  elevated: '#1E1E21', // kart içi kart, input, basılı durum
  border: '#2A2A2F', // ince ayraç
  text: '#FAFAFA',
  muted: '#8A8A90', // ikincil metin
  accent: '#D7FF3E', // limon vurgu
  accentFg: '#0A0A0B', // vurgu üstündeki metin
  warm: '#FF9A3C', // kardiyo
  danger: '#FF5A5A',
} as const;

/** Soluk ikon / devre dışı öğe rengi (ör. sınırdaki gezinme okları) */
export const DISABLED_ICON = COLORS.border;
