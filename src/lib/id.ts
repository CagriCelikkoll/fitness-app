import * as Crypto from 'expo-crypto';

/**
 * Tüm primary key'lerimiz UUID v4. Sync zamanı çakışma olmasın diye.
 * expo-crypto her platformda native crypto kullanır, hızlı ve güvenli.
 */
export function newId(): string {
  return Crypto.randomUUID();
}
