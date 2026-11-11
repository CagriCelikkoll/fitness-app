/**
 * Uygulama varyantları (v4.0a ek). Temel ayarlar `app.json`'da; bu dosya
 * yalnızca `APP_VARIANT` verildiğinde üstüne yazar.
 *
 * - `APP_VARIANT` yok: `app.json` hiç değişmeden döner (Play sürümü).
 * - `APP_VARIANT=dahili`: "Dinç Test", Play sürümünün yanına kurulan ayrı
 *   uygulama (`eas.json` → `dahili` profili). FCM yok: `google-services.json`
 *   yalnızca Play paketine kayıtlı.
 *
 * `version`, `runtimeVersion`, `updates`, `slug`, `extra.eas` ortak: OTA
 * aynı EAS projesinden ve aynı çalışma zamanından gelir.
 *
 * `eas update` bu değişkeni görmez (manifest temel ayarlarla üretilir); bu
 * yüzden uygulama test sürümü olduğunu buradan değil, derlemenin kanalından
 * anlar (`src/lib/appVariant.ts`).
 */

const TEST_ICONS = './assets/brand/test';

function withVariant(config, variant) {
  if (!variant) return config;
  if (variant !== 'dahili') {
    throw new Error(`Bilinmeyen APP_VARIANT: "${variant}" (geçerli: dahili)`);
  }

  const { googleServicesFile: _fcmOnlyForPlay, ...android } = config.android;
  return {
    ...config,
    name: 'Dinç Test',
    scheme: 'dinc-dahili',
    icon: `${TEST_ICONS}/icon.png`,
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.dincapp.antrenman.dahili',
      icon: `${TEST_ICONS}/icon.png`,
    },
    android: {
      ...android,
      package: 'com.dincapp.antrenman.dahili',
      adaptiveIcon: {
        ...android.adaptiveIcon,
        foregroundImage: `${TEST_ICONS}/adaptive-icon.png`,
        monochromeImage: `${TEST_ICONS}/monochrome-icon.png`,
      },
    },
  };
}

module.exports = ({ config }) => withVariant(config, process.env.APP_VARIANT);
