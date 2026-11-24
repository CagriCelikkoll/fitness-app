import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';

import { DARK_SCREEN_BAR_STYLE } from '@/lib/systemBars';

/**
 * Görselli koyu ekranlar (karşılama, kapaklar, rekor) açık temada da koyu:
 * durum ve gezinme çubuğu içeriği açık renk. Ekrandan çıkınca kökteki
 * tema ayarına döner (iki bileşen de yığın gibi çalışıyor).
 */
export function DarkSystemBars() {
  return (
    <>
      <StatusBar style={DARK_SCREEN_BAR_STYLE} />
      <NavigationBar style={DARK_SCREEN_BAR_STYLE} />
    </>
  );
}
