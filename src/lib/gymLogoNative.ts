/**
 * Salon logosu seçme (v3.3, ince native katman): galeriden seç (sistem
 * kırpıcısında kare) → ortadan kare kırp (kırpıcı kullanılmadıysa) →
 * en fazla 512 px → JPEG. Yükleme `gymLogo.ts`'te. `restNative.ts` gibi
 * native modül içe aktaran istisnalardan; testlerde içe aktarılmıyor.
 */

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { GYM_LOGO_SIZE, centerSquare } from '@/lib/gymLogo';

/** Seçilmezse null */
export async function pickGymLogo(): Promise<ArrayBuffer | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  let side = GYM_LOGO_SIZE;
  if (asset.width > 0 && asset.height > 0) {
    if (asset.width !== asset.height) context.crop(centerSquare(asset.width, asset.height));
    side = Math.min(GYM_LOGO_SIZE, asset.width, asset.height);
  }
  context.resize({ width: side, height: side });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return new File(saved.uri).arrayBuffer();
}
