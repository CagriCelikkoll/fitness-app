/**
 * Uygulama varyantları (v4.0a ek). Temel ayarlar `app.json`'da; bu dosya
 * yalnızca `APP_VARIANT` verildiğinde üstüne yazar.
 *
 * - `APP_VARIANT` yok: `app.json` hiç değişmeden döner (Play sürümü);
 *   yalnızca Google iOS kimliği verildiyse iOS URL şeması eklentisi eklenir.
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
 *
 * Google ile giriş (0.13): Android'de uygulamaya giren tek değer web istemci
 * kimliği (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, EAS ortam değişkeni); iki
 * varyantta aynı, çünkü jetonun hedefi (aud) Supabase'in tanıdığı web
 * istemcisi. Dinç Test'in ayrı paketi (`com.dincapp.antrenman.dahili`) için
 * Google Cloud'da ayrı bir Android istemcisi açılır (paket + SHA-1); onun
 * kimliği uygulamaya girmez, Google paket adı ve imzayla eşleştirir.
 *
 * iOS (0.13 Bölüm 5): iOS istemcisi bundle id'ye bağlı, varyant başına bir
 * tane: `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `…_DAHILI`. Burada yalnızca
 * derlemeye giren URL şeması üretilir (google-signin eklentisi); kimlik yoksa
 * eklenti eklenmez, config değişmez (Android derlemesi etkilenmez). Uygulama
 * kimliği çalışırken kanaldan seçer (`src/lib/googleSignInNative.ts`), OTA
 * manifest'i `APP_VARIANT`'ı görmediği için (yukarıda).
 */

const TEST_ICONS = './assets/brand/test';
const GOOGLE_SIGNIN_PLUGIN = '@react-native-google-signin/google-signin';
const GOOGLE_CLIENT_ID = /^(\d+-[a-z0-9]+)\.apps\.googleusercontent\.com$/;

/** iOS istemci kimliği → URL şeması (`src/lib/googleAuth.ts` `googleIosUrlScheme` ile aynı) */
function googleIosUrlScheme(clientId) {
  const match = GOOGLE_CLIENT_ID.exec(clientId);
  if (!match) {
    throw new Error(`Google iOS istemci kimliği biçimi bozuk: "${clientId}" (beklenen: <sayı>-<x>.apps.googleusercontent.com)`);
  }
  return `com.googleusercontent.apps.${match[1]}`;
}

function withGoogleIos(config, variant) {
  const raw =
    variant === 'dahili'
      ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID_DAHILI
      : process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const clientId = raw ? raw.trim() : '';
  if (!clientId) return config;
  return {
    ...config,
    plugins: [...config.plugins, [GOOGLE_SIGNIN_PLUGIN, { iosUrlScheme: googleIosUrlScheme(clientId) }]],
  };
}

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

module.exports = ({ config }) => {
  const variant = process.env.APP_VARIANT;
  return withGoogleIos(withVariant(config, variant), variant);
};
