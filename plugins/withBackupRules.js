/**
 * Android otomatik yedekleme kuralları (v0.13, pentest DNC-05).
 *
 * Android uygulama verisini Google Drive'a yedekliyor ve yeni telefona
 * taşıyor (`allowBackup`, varsayılan açık). Oturum anahtarları ve hassas
 * tercihler buluta / başka cihaza gitmesin:
 *
 * HARİÇ (yedeklenmez, taşınmaz):
 * - `sharedpref/SecureStore.xml` — expo-secure-store'un şifreli değerleri
 *   (Supabase oturumu). Anahtarı Keystore'da, zaten başka cihazda çözülemez.
 * - `file/SQLite/ExpoSQLiteStorage*` — expo-sqlite kv-store: 0.12'den kalan
 *   oturum kopyası, push kaydı, salon / ziyaret önbellekleri, rıza ve
 *   bildirim tercihleri.
 *
 * DAHİL (değişmedi): `file/SQLite/fitness.db*` (antrenmanlar, rutinler,
 * ayarlar) ve diğer uygulama dosyaları. Kullanıcının kendi "Dışa aktar /
 * Geri yükle" özelliği bu kurallardan etkilenmez (dosyayı kullanıcı seçer).
 *
 * İki dosya: Android 12+ `dataExtractionRules`, Android 11 ve öncesi
 * (Android 9 dahil) `fullBackupContent`. expo-secure-store'un kendi
 * kuralları kapalı (`configureAndroidBackup: false`); onlarınki yalnızca
 * sharedpref'i yedekliyordu (veritabanı hiç yedeklenmiyordu).
 *
 * Kurallar `test/backupRules.test.ts`'te denetleniyor.
 */

const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const EXCLUDES = [
  { domain: 'sharedpref', path: 'SecureStore.xml' },
  { domain: 'file', path: 'SQLite/ExpoSQLiteStorage' },
  { domain: 'file', path: 'SQLite/ExpoSQLiteStorage-wal' },
  { domain: 'file', path: 'SQLite/ExpoSQLiteStorage-shm' },
  { domain: 'file', path: 'SQLite/ExpoSQLiteStorage-journal' },
];

const lines = (indent) => EXCLUDES.map((e) => `${indent}<exclude domain="${e.domain}" path="${e.path}" />`).join('\n');

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12+ otomatik yedekleme ve cihaz aktarımı (plugins/withBackupRules.js) -->
<data-extraction-rules>
  <cloud-backup>
${lines('    ')}
  </cloud-backup>
  <device-transfer>
${lines('    ')}
  </device-transfer>
</data-extraction-rules>
`;

const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 11 ve öncesi otomatik yedekleme (plugins/withBackupRules.js) -->
<full-backup-content>
${lines('  ')}
</full-backup-content>
`;

const EXTRACTION_FILE = 'dinc_data_extraction_rules';
const BACKUP_FILE = 'dinc_backup_rules';

function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${EXTRACTION_FILE}.xml`), DATA_EXTRACTION_RULES);
      fs.writeFileSync(path.join(dir, `${BACKUP_FILE}.xml`), FULL_BACKUP_CONTENT);
      return c;
    },
  ]);

  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (!app) throw new Error('withBackupRules: <application> bulunamadı');
    app.$['android:allowBackup'] = 'true';
    app.$['android:dataExtractionRules'] = `@xml/${EXTRACTION_FILE}`;
    app.$['android:fullBackupContent'] = `@xml/${BACKUP_FILE}`;
    return c;
  });
}

module.exports = withBackupRules;
module.exports.EXCLUDES = EXCLUDES;
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.FULL_BACKUP_CONTENT = FULL_BACKUP_CONTENT;
