import { useState } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { useDb } from '@/hooks/useDb';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import {
  BACKUP_TABLE_KEYS,
  TABLE_LABELS,
  countRecords,
  restoreBackup,
  validateBackup,
  type BackupFile,
} from '@/lib/backup';
import { formatDateTime } from '@/lib/format';

/** Yedekteki kayıt sayıları, uyarı metni için satır satır */
export function summarizeCounts(counts: Record<string, number>): string {
  const lines = BACKUP_TABLE_KEYS.filter((key) => counts[key] > 0).map(
    (key) => `${TABLE_LABELS[key] ?? key}: ${counts[key]}`
  );
  return lines.length > 0 ? lines.join('\n') : 'Yedekte hiç kayıt yok.';
}

/**
 * Yedekten geri yükleme akışı: dosya seç → doğrula → içeriği göster →
 * "mevcut veriler silinecek" onayı → geri yükle.
 *
 * Ayarlar'daki Veri yönetimi ve karşılama ekranı aynı akışı kullanıyor.
 * Başarılı geri yüklemeden sonra `onRestored` çağrılıyor (ekrana göre
 * yönlendirme), ardından "Geri yüklendi" uyarısı.
 */
export function useBackupRestore(onRestored: () => void | Promise<void>): {
  importing: boolean;
  startRestore: () => Promise<void>;
} {
  const db = useDb();
  const endSession = useActiveWorkoutStore((s) => s.endSession);
  const [importing, setImporting] = useState(false);

  /** Onay alındıktan sonraki asıl geri yükleme */
  const runRestore = async (data: BackupFile) => {
    setImporting(true);
    try {
      await restoreBackup(db, data);
      // Silinen seansa işaret eden state kalmasın
      endSession();
      await onRestored();
      Alert.alert('Geri yüklendi', 'Yedekteki veriler yüklendi.');
    } catch (err) {
      console.error('[BACKUP-IMPORT] HATA:', err);
      Alert.alert('Geri yükleme hatası', String(err));
    } finally {
      setImporting(false);
    }
  };

  const startRestore = async () => {
    try {
      // Tür filtresi yok: bazı dosya sağlayıcıları JSON'u application/json
      // olarak bildirmiyor, filtreleyince yedek dosyası seçilemez hale
      // geliyor. Dosyanın gerçekten yedek olup olmadığını validateBackup
      // söylüyor.
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      if (!asset) return;

      setImporting(true);
      const raw = await new File(asset.uri).text();
      setImporting(false);

      const result = validateBackup(raw);
      if (!result.ok) {
        Alert.alert('Dosya okunamadı', result.error);
        return;
      }

      const data = result.data;
      const counts = countRecords(data);
      const exportedAt = data.exportedAt
        ? formatDateTime(data.exportedAt)
        : 'bilinmiyor';

      Alert.alert(
        'Yedek içeriği',
        `Alındığı tarih: ${exportedAt}\nUygulama sürümü: ${data.appVersion}\n\n${summarizeCounts(counts)}`,
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Devam',
            onPress: () =>
              Alert.alert(
                'Mevcut tüm veriler silinecek',
                'Geri yükleme birleştirme yapmaz. Cihazdaki rutinler, antrenmanlar, ölçümler ve egzersiz kütüphanesi silinip yedektekiyle değiştirilecek. Bu işlem geri alınamaz.',
                [
                  { text: 'Vazgeç', style: 'cancel' },
                  {
                    text: 'Evet, geri yükle',
                    style: 'destructive',
                    onPress: () => void runRestore(data),
                  },
                ]
              ),
          },
        ]
      );
    } catch (err) {
      setImporting(false);
      console.error('[BACKUP-IMPORT] HATA:', err);
      Alert.alert('Dosya okunamadı', String(err));
    }
  };

  return { importing, startRestore };
}
