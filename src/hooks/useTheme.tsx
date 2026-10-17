import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import Storage from 'expo-sqlite/kv-store';
import { vars } from 'nativewind';
import { create } from 'zustand';

import { useGymFeatures } from '@/hooks/useGymFeatures';
import { useGymMembership } from '@/hooks/useGymMembership';
import { isGymColor } from '@/lib/gymAdmin';
import { ONBOARDING_FLAG_KEY } from '@/lib/onboarding';
import {
  GYM_ACCENT_KEY,
  THEME_MODE_KEY,
  canUseGymAccent,
  initialThemeMode,
  parseGymAccentEnabled,
  resolveAccent,
  resolveScheme,
  type ThemeMode,
} from '@/lib/themeMode';
import {
  DARK_COLORS,
  buildColors,
  cssVariables,
  gymAccentTones,
  type AccentTones,
  type ColorScheme,
  type ThemeColors,
} from '@/theme';

/**
 * Tema (v3.5): Sistem / Açık / Koyu ve salon vurgusu.
 *
 * - Seçim kv-store'da; açılışta EŞZAMANLI okunuyor (`getItemSync`), ilk
 *   karede yanlış tema yanıp sönmesin.
 * - `Appearance.setColorScheme`: uygulamanın gece modu seçime uyuyor;
 *   sistem çubukları, Alert, klavye ve tarih seçici de. "Sistem"de
 *   telefon ayarı değişince `useColorScheme` haber veriyor, anında değişir.
 * - NativeWind sınıfları kökteki `vars()` ile, satır içi renkler
 *   `useColors()` ile güncelleniyor; yeniden başlatma yok.
 */

interface ThemePrefs {
  mode: ThemeMode;
  gymAccent: boolean;
}

function readPrefs(): ThemePrefs {
  try {
    const stored = Storage.getItemSync(THEME_MODE_KEY);
    const mode = initialThemeMode(stored, Storage.getItemSync(ONBOARDING_FLAG_KEY) === '1');
    if (stored !== mode) Storage.setItemSync(THEME_MODE_KEY, mode);
    return { mode, gymAccent: parseGymAccentEnabled(Storage.getItemSync(GYM_ACCENT_KEY)) };
  } catch (err) {
    console.warn('[THEME] Tercih okunamadı:', err);
    return { mode: 'dark', gymAccent: true };
  }
}

const usePrefsStore = create<ThemePrefs>(() => readPrefs());

function save(key: string, value: string): void {
  Storage.setItem(key, value).catch((err) => console.warn('[THEME] Tercih kaydedilemedi:', err));
}

export function setThemeMode(mode: ThemeMode): void {
  usePrefsStore.setState({ mode });
  save(THEME_MODE_KEY, mode);
}

export function setGymAccentEnabled(enabled: boolean): void {
  usePrefsStore.setState({ gymAccent: enabled });
  save(GYM_ACCENT_KEY, enabled ? '1' : '0');
}

interface ThemeState {
  mode: ThemeMode;
  scheme: ColorScheme;
  colors: ThemeColors;
  gymAccent: boolean;
  /** Ayarlar'da "Salon rengini kullan" görünsün mü */
  gymAccentAvailable: boolean;
}

const ThemeContext = createContext<ThemeState>({
  mode: 'dark',
  scheme: 'dark',
  colors: DARK_COLORS,
  gymAccent: true,
  gymAccentAvailable: false,
});

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { mode, gymAccent } = usePrefsStore();
  const system = useColorScheme();
  const { available } = useGymFeatures();
  const { primary } = useGymMembership();

  // "Sistem"de uygulamanın gece modu telefona bırakılıyor; `useColorScheme`
  // ondan sonra telefonun değerini veriyor
  useEffect(() => {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);

  const scheme = resolveScheme(mode, system);
  const gymColor = primary?.primaryColor ?? null;
  const state = useMemo<ThemeState>(() => {
    const accent = resolveAccent({ scheme, gymFeatures: available, gymAccentEnabled: gymAccent, gymColor });
    return {
      mode,
      scheme,
      colors: buildColors(scheme, accent.tones),
      gymAccent,
      gymAccentAvailable: canUseGymAccent(available, gymColor),
    };
  }, [mode, scheme, available, gymAccent, gymColor]);

  const rootStyle = useMemo(() => [{ flex: 1 }, vars(cssVariables(state.colors))], [state.colors]);

  // Pencere zemini (klavye açılırken / ekran geçişinde görünen)
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(state.colors.bg).catch(() => {});
  }, [state.colors.bg]);

  return (
    <ThemeContext.Provider value={state}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={rootStyle}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

/** Satır içi renkler (ikon, SVG, navigasyon, Switch) */
export function useColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

/**
 * Bir salonun rengi bu temada (salon satırı, logo baş harfi). Vurgu
 * anahtarından bağımsız: salonun kimliği. Renk listede değilse uygulamanın
 * o anki vurgusu.
 */
export function useGymTones(gymColor: string | null | undefined): AccentTones {
  const { scheme, colors } = useTheme();
  return useMemo(
    () =>
      isGymColor(gymColor)
        ? gymAccentTones(gymColor, scheme)
        : { fill: colors.accentFill, onFill: colors.accentFg, ink: colors.accent },
    [gymColor, scheme, colors]
  );
}
