/**
 * "Dinç Test" uygulaması (v4.0a ek; `app.config.js`, `eas.json` → `dahili`).
 *
 * Test sürümü olduğu `APP_VARIANT`'tan ya da `Constants.expoConfig`'den
 * anlaşılamaz: `eas update` manifest'i temel ayarlarla üretir ve ilk OTA'dan
 * sonra `expoConfig` Play sürümününkiyle aynı görünür. Derlemenin kanalı
 * (`Updates.channel`) native tarafta sabit, OTA ile değişmez.
 */

export const INTERNAL_CHANNEL = 'dahili';

export function isInternalChannel(channel: string | null | undefined): boolean {
  return channel === INTERNAL_CHANNEL;
}
