/**
 * Titreşim (v0.13) — saf karar. Native çağrı `hapticsNative.ts`'te.
 *
 * - Set tamamlandı → hafif; dinlenme bitti → orta; rekor → başarı.
 * - Kullanıcı ayarı: Profil → Birimler ve dinlenme → "Titreşim"
 *   (`app_settings.restTimerVibrate`, varsayılan açık). Kapalıysa hiç
 *   titreşim yok.
 * - Sistem titreşimi zorlanmaz: Android'de `View.performHapticFeedback`
 *   (sistemin "dokunma titreşimi" ayarına uyar; `Vibrator` doğrudan
 *   kullanılmaz). iOS'ta Taptic Engine sistem ayarına kendisi uyar.
 */

export type HapticKind = 'setComplete' | 'restDone' | 'record';

export type HapticCall =
  | { api: 'androidHaptics'; type: 'keyboard-tap' | 'long-press' | 'confirm'; fallback?: 'long-press' }
  | { api: 'impact'; style: 'light' | 'medium' }
  | { api: 'notification'; type: 'success' };

/** Hangi native çağrı; titreşim kapalıysa null */
export function hapticCall(kind: HapticKind, platform: string, enabled: boolean): HapticCall | null {
  if (!enabled) return null;
  if (platform === 'android') {
    switch (kind) {
      case 'setComplete':
        return { api: 'androidHaptics', type: 'keyboard-tap' };
      case 'restDone':
        return { api: 'androidHaptics', type: 'long-press' };
      case 'record':
        // CONFIRM Android 11+; eski sürümlerde (Huawei / Android 9) uzun basış
        return { api: 'androidHaptics', type: 'confirm', fallback: 'long-press' };
    }
  }
  if (platform === 'ios') {
    switch (kind) {
      case 'setComplete':
        return { api: 'impact', style: 'light' };
      case 'restDone':
        return { api: 'impact', style: 'medium' };
      case 'record':
        return { api: 'notification', type: 'success' };
    }
  }
  return null;
}
