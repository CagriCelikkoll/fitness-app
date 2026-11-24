/**
 * Paylaşım kartını görüntüye çevirip sistem paylaşım sayfasını açar (0.13
 * Bölüm 3). Native modül içe aktarıyor; testte kullanılmaz.
 *
 * - react-native-view-shot: kart 1080 × 1920 PNG, uygulamanın geçici
 *   klasörüne.
 * - expo-sharing: sistemin paylaşım sayfası; Instagram ve WhatsApp
 *   kendiliğinden listede. Meta SDK'sı / Facebook uygulama kimliği yok.
 * - Paylaşım sayfası kapanınca dosya silinir. Hiçbir şey sunucuya gitmez.
 */

import type { RefObject } from 'react';
import type { View } from 'react-native';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from '@/lib/shareCard';

export type ShareOutcome = 'shared' | 'unavailable';

function removeTemp(uri: string): void {
  try {
    releaseCapture(uri);
  } catch {
    // view-shot silemezse dosya sistemiyle dene
  }
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (err) {
    console.warn('[SHARE] Geçici görüntü silinemedi:', err);
  }
}

/** Kartı görüntüye çevirip paylaş; paylaşım yoksa (ör. emülatör) 'unavailable' */
export async function shareCardImage(ref: RefObject<View | null>): Promise<ShareOutcome> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  if (!ref.current) throw new Error('Paylaşım kartı hazır değil');
  const uri = await captureRef(ref, {
    format: 'png',
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    result: 'tmpfile',
    fileName: `dinc-paylasim-${Date.now()}`,
  });
  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'Paylaş',
    });
  } finally {
    removeTemp(uri);
  }
  return 'shared';
}
