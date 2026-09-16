/**
 * Yedeğin dosya / paylaşım tarafı.
 *
 * `src/lib/backup.ts` saf veritabanı mantığını tutuyor ve hiçbir Expo
 * modülü import etmiyor — böylece Node'da (testlerde) doğrudan
 * çalıştırılabiliyor. Cihaza özgü olan her şey burada:
 * `expo-file-system`, `expo-sharing`, `expo-constants`.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';

import type { Db } from '@/db/client';
import { backupFileName, buildBackup, type BackupFile } from '@/lib/backup';

/** app.json'daki sürüm; okunamazsa yedek yine de alınabilsin */
export function getAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/**
 * Yedeği önbellek dizinine yazar ve paylaşım sayfasını açar.
 * Dosya yolunu döndürür; paylaşım iptal edilse bile dosya orada kalır.
 */
export async function exportBackup(db: Db): Promise<string> {
  return shareBackup(await buildBackup(db, getAppVersion()));
}

/**
 * Hazır bir yedek nesnesini dosyaya yazıp paylaşır. Ekran kaç kayıt
 * aktarıldığını söyleyebilmek için yedeği kendisi kurup buraya veriyor;
 * böylece veritabanı iki kez okunmuyor.
 */
export async function shareBackup(backup: BackupFile): Promise<string> {
  const file = new File(Paths.cache, backupFileName());
  // Aynı gün ikinci kez yedek alınırsa üstüne yaz
  file.create({ overwrite: true });
  file.write(JSON.stringify(backup));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Yedeği kaydet veya paylaş',
    });
  }

  return file.uri;
}
