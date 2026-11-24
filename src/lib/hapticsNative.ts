/**
 * Titreşim çağrıları (expo-haptics). Karar `haptics.ts`'te (saf, test
 * edilir). Native modül içe aktarıyor; testte kullanılmaz.
 *
 * Hata yutulur: titreşim hiçbir akışı bozmamalı (set tamamlama, dinlenme).
 */

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import { hapticCall, type HapticKind } from '@/lib/haptics';

async function run(kind: HapticKind, enabled: boolean): Promise<void> {
  const call = hapticCall(kind, Platform.OS, enabled);
  if (!call) return;
  if (call.api === 'androidHaptics') {
    try {
      await Haptics.performAndroidHapticsAsync(call.type as Haptics.AndroidHaptics);
    } catch (err) {
      if (!call.fallback) throw err;
      await Haptics.performAndroidHapticsAsync(call.fallback as Haptics.AndroidHaptics);
    }
    return;
  }
  if (call.api === 'impact') {
    await Haptics.impactAsync(
      call.style === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium
    );
    return;
  }
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/** Titreşim; `enabled` kullanıcı ayarı */
export function haptic(kind: HapticKind, enabled: boolean): void {
  run(kind, enabled).catch((err) => console.warn('[HAPTICS] Titreşim çalmadı:', err));
}
