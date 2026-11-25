import { useEffect, useState } from 'react';
import { Keyboard, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { floatingTabBarLayout, screenBottomInset, screenTopInset, sheetBottomPadding } from '@/lib/safeArea';

/**
 * Alt güvenli alan kancaları (v3.6e). Kurallar `src/lib/safeArea.ts`'te.
 * Ekranlar bunları doğrudan kullanmaz; yığın ekranlarının boşluğunu
 * `app/_layout.tsx` veriyor. Alttan açılan Modal sayfaları
 * `useSheetBottomPadding()` kullanır.
 */

/**
 * Klavye açık mı. iOS'ta "Will" olayları (0.13 Bölüm 5): boşluk klavyenin
 * açılma animasyonuyla birlikte değişsin, "Did" sonrası zıplamasın. Android
 * yalnızca "Did" olaylarını gönderiyor.
 */
const KEYBOARD_EVENTS =
  Platform.OS === 'ios'
    ? ({ show: 'keyboardWillShow', hide: 'keyboardWillHide' } as const)
    : ({ show: 'keyboardDidShow', hide: 'keyboardDidHide' } as const);

export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(KEYBOARD_EVENTS.show, () => setVisible(true));
    const hide = Keyboard.addListener(KEYBOARD_EVENTS.hide, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** Kök yığın için: rota adı → içerik kabının alt boşluğu */
export function useScreenBottomInset(): (route: string) => number {
  const { bottom } = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  return (route: string) => screenBottomInset(route, bottom, keyboard);
}

/**
 * Başlıksız ekranın (v4.0a odak modu, dinlenme, özet) üst boşluğu: durum
 * çubuğunun altı. Yalnızca üst; alt boşluk yine kökten.
 */
export function useScreenTopInset(): number {
  return screenTopInset(useSafeAreaInsets().top, StatusBar.currentHeight);
}

/** Alttan açılan sayfanın (Modal) alt boşluğu */
export function useSheetBottomPadding(base?: number): number {
  const { bottom } = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  return sheetBottomPadding(bottom, keyboard, base);
}

/** Havada duran alt menünün konumu ve sekme ekranlarının alt boşluğu (v4.0a) */
export function useFloatingTabBarLayout(): { bottom: number; scenePadding: number; keyboardVisible: boolean } {
  const { bottom } = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  return { ...floatingTabBarLayout(bottom, keyboard), keyboardVisible: keyboard };
}
