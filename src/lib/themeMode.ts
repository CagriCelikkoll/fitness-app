/**
 * Tema seçimi ve vurgu kaynağı (v3.5) — saf karar mantığı.
 *
 * - Tema: Sistem / Açık / Koyu (kv-store `theme.mode`). İlk açılışta bir
 *   kez belirlenir: telefonda daha önce kullanılmış uygulama (karşılama
 *   tamamlanmış) → Koyu, yeni kurulum → Sistem. Sonra kullanıcının seçimi.
 * - Vurgu: salon üyesiyken (bayrak açık) "Salon rengini kullan" açıksa ve
 *   salonun rengi hazır listedeyse salonun tonu; yoksa Dinç limonu.
 *
 * Arayüz ve depolama `src/hooks/useTheme.tsx`'te.
 */

import { isGymColor } from '@/lib/gymAdmin';
import { DINC_ACCENT, gymAccentTones, type AccentTones, type ColorScheme } from '@/theme';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_KEY = 'theme.mode';
export const GYM_ACCENT_KEY = 'theme.gymAccent';

export const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Sistem' },
  { value: 'light', label: 'Açık' },
  { value: 'dark', label: 'Koyu' },
];

export function parseThemeMode(raw: string | null | undefined): ThemeMode | null {
  return raw === 'system' || raw === 'light' || raw === 'dark' ? raw : null;
}

/**
 * Kayıtlı seçim varsa o. Yoksa (ilk açılış) mevcut kullanıcıya Koyu —
 * arkadaşlar güncellemeden sonra bir anda beyaz ekranla karşılaşmasın —,
 * yeni kuruluma Sistem. Dönen değer kaydedilir, bir daha hesaplanmaz.
 */
export function initialThemeMode(stored: string | null | undefined, hasExistingData: boolean): ThemeMode {
  return parseThemeMode(stored) ?? (hasExistingData ? 'dark' : 'system');
}

/** Sistem bilinmiyorsa koyu (Dinç'in asıl görünümü) */
export function resolveScheme(mode: ThemeMode, system: string | null | undefined): ColorScheme {
  if (mode !== 'system') return mode;
  return system === 'light' ? 'light' : 'dark';
}

/** Varsayılan açık */
export function parseGymAccentEnabled(raw: string | null | undefined): boolean {
  return raw !== '0';
}

export interface AccentInput {
  scheme: ColorScheme;
  /** Bayrak açık ve Supabase hazır (`useGymFeatures().available`) */
  gymFeatures: boolean;
  gymAccentEnabled: boolean;
  /** Ana salonun rengi; üye değilse null */
  gymColor: string | null | undefined;
}

export function resolveAccent({ scheme, gymFeatures, gymAccentEnabled, gymColor }: AccentInput): {
  source: 'gym' | 'dinc';
  tones: AccentTones;
} {
  if (gymFeatures && gymAccentEnabled && isGymColor(gymColor)) {
    return { source: 'gym', tones: gymAccentTones(gymColor, scheme) };
  }
  return { source: 'dinc', tones: DINC_ACCENT[scheme] };
}

/** Ayarlar'daki "Salon rengini kullan" yalnızca renkli bir salona üyeyken */
export function canUseGymAccent(gymFeatures: boolean, gymColor: string | null | undefined): boolean {
  return gymFeatures && isGymColor(gymColor);
}
