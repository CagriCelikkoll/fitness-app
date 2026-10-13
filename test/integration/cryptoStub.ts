/** Entegrasyon testlerinde expo-crypto yerine: gerçek UUID v4 */
import { randomUUID as nodeRandomUUID } from 'node:crypto';

export function randomUUID(): string {
  return nodeRandomUUID();
}
