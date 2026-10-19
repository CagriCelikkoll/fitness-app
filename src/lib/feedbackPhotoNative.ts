/**
 * Geri bildirim fotoğrafı (v3.6d, ince native katman): sistem fotoğraf
 * seçicisiyle tek görsel → uzun kenar en fazla 1024 px → JPEG. Mevcut
 * expo-image-picker + expo-image-manipulator; yeni izin yok. Yükleme
 * `feedback.ts`'te. `gymLogoNative.ts` gibi testlerde içe aktarılmıyor.
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { FEEDBACK_PHOTO_MAX_BYTES, fitWithin } from '@/lib/feedback';

export interface PickedPhoto {
  /** Önizleme için yerel dosya */
  uri: string;
  bytes: ArrayBuffer;
}

/** Seçilmezse null; en düşük kalitede bile 1 MB'ı aşarsa 'too_large' */
export async function pickFeedbackPhoto(): Promise<PickedPhoto | 'too_large' | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  context.resize(fitWithin(asset.width, asset.height));
  const image = await context.renderAsync();
  // Büyük ve ayrıntılı fotoğraf sınırı aşarsa biraz daha sıkıştır
  for (const compress of [0.75, 0.6, 0.45]) {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress });
    const bytes = await new File(saved.uri).arrayBuffer();
    if (bytes.byteLength <= FEEDBACK_PHOTO_MAX_BYTES) return { uri: saved.uri, bytes };
  }
  return 'too_large';
}
