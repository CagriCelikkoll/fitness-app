/**
 * Supabase oturumu güvenli depoda (v0.13, pentest DNC-02) — saf, testte
 * bellek depolarıyla kullanılır. Uygulamadaki kurulum `sessionStoreNative.ts`
 * (expo-secure-store + expo-sqlite kv-store).
 *
 * - Oturum (erişim + yenileme token'ı) Android Keystore / iOS Keychain ile
 *   şifrelenen güvenli depoda. 0.12'ye kadar düz metin kv-store'daydı.
 * - **Parçalama:** SecureStore tek değerde ~2 KB'ı aşınca uyarıyor (iOS'ta
 *   reddedilebiliyor); Google girişiyle oturum JSON'u 3–4 KB'ı buluyor.
 *   Değer `PARÇA` boyunda parçalara bölünür: `<anahtar>__0`, `__1`…, sayısı
 *   `<anahtar>__n`. Yazarken önce parçalar, en son sayı yazılır; eksik parça
 *   okunursa oturum yok sayılır (yarım token kullanılmaz).
 * - **Taşıma:** güvenli depoda değer yoksa eski depoya (kv-store) bakılır;
 *   varsa güvenli depoya yazılır, geri okunup doğrulanır, sonra eskisi
 *   silinir. Kullanıcı oturumu kaybetmez.
 * - **Güvenli depo bozuksa** (bazı cihazlarda Keystore hatası): yazma
 *   başarısızsa değer eski depoda kalır ve hata loglanır; kullanıcı
 *   çıkış yapmış duruma düşmez. Okuma tekrar denendiğinde taşıma yeniden
 *   denenir.
 */

import type { SessionStorage } from '@/lib/supabaseConfig';

/** expo-secure-store'un kullandığımız kısmı */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Parça boyu (karakter). SecureStore'un 2048 bayt uyarısının altında; JSON ASCII */
export const SECURE_CHUNK_SIZE = 1800;

/** Bir değere en fazla bu kadar parça (≈ 54 KB); fazlası hata */
export const MAX_SECURE_CHUNKS = 30;

const countKey = (key: string) => `${key}__n`;
const chunkKey = (key: string, i: number) => `${key}__${i}`;

/** SecureStore anahtarı yalnızca harf, rakam, ".", "-", "_" kabul ediyor */
export function isValidSecureKey(key: string): boolean {
  return /^[\w.-]+$/.test(key);
}

export function splitIntoChunks(value: string, size = SECURE_CHUNK_SIZE): string[] {
  if (value.length === 0) return [''];
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

async function readChunked(secure: SecureStoreLike, key: string): Promise<string | null> {
  const rawCount = await secure.getItemAsync(countKey(key));
  if (rawCount == null) return null;
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 1 || count > MAX_SECURE_CHUNKS) return null;
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = await secure.getItemAsync(chunkKey(key, i));
    if (part == null) {
      console.error('[SESSION] Güvenli depoda eksik parça; oturum yok sayıldı');
      return null;
    }
    parts.push(part);
  }
  return parts.join('');
}

async function previousCount(secure: SecureStoreLike, key: string): Promise<number> {
  const raw = await secure.getItemAsync(countKey(key)).catch(() => null);
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= MAX_SECURE_CHUNKS ? n : 0;
}

async function writeChunked(secure: SecureStoreLike, key: string, value: string): Promise<void> {
  const chunks = splitIntoChunks(value);
  if (chunks.length > MAX_SECURE_CHUNKS) throw new Error('Oturum güvenli depo için çok büyük');
  const before = await previousCount(secure, key);
  for (let i = 0; i < chunks.length; i += 1) await secure.setItemAsync(chunkKey(key, i), chunks[i]!);
  await secure.setItemAsync(countKey(key), String(chunks.length));
  // Kısalan değerin artakalan parçaları
  for (let i = chunks.length; i < before; i += 1) await secure.deleteItemAsync(chunkKey(key, i));
}

async function deleteChunked(secure: SecureStoreLike, key: string): Promise<void> {
  const before = await previousCount(secure, key);
  await secure.deleteItemAsync(countKey(key));
  for (let i = 0; i < before; i += 1) await secure.deleteItemAsync(chunkKey(key, i));
}

/**
 * Supabase'in `storage` adaptörü: güvenli depo, eski depodan tek seferlik
 * taşıma ile.
 */
export function createSecureSessionStorage(deps: {
  secure: SecureStoreLike;
  /** 0.12'ye kadarki düz depo (kv-store) */
  legacy: SessionStorage;
}): SessionStorage {
  const { secure, legacy } = deps;

  return {
    async getItem(key) {
      if (!isValidSecureKey(key)) throw new Error(`Geçersiz güvenli depo anahtarı: ${key}`);
      let stored: string | null = null;
      try {
        stored = await readChunked(secure, key);
      } catch (err) {
        console.error('[SESSION] Güvenli depo okunamadı:', err);
      }
      if (stored != null) return stored;

      // Taşıma (0.12 → 0.13): eski depoda varsa güvenli depoya geçir
      const old = await legacy.getItem(key);
      if (old == null) return null;
      try {
        await writeChunked(secure, key, old);
        if ((await readChunked(secure, key)) !== old) throw new Error('doğrulama tutmadı');
        await legacy.removeItem(key);
      } catch (err) {
        console.error('[SESSION] Oturum güvenli depoya taşınamadı; eski depoda kaldı:', err);
      }
      return old;
    },

    async setItem(key, value) {
      if (!isValidSecureKey(key)) throw new Error(`Geçersiz güvenli depo anahtarı: ${key}`);
      try {
        await writeChunked(secure, key, value);
      } catch (err) {
        // Keystore bozuk cihaz: oturum kaybolmasın
        console.error('[SESSION] Güvenli depoya yazılamadı; eski depoya yazıldı:', err);
        // Güvenli depodaki eski (artık geçersiz) token okunmasın
        await deleteChunked(secure, key).catch(() => {});
        await legacy.setItem(key, value);
        return;
      }
      // Eski kopya kalmasın (düz metin)
      await legacy.removeItem(key).catch(() => {});
    },

    async removeItem(key) {
      if (!isValidSecureKey(key)) return;
      try {
        await deleteChunked(secure, key);
      } catch (err) {
        console.error('[SESSION] Güvenli depodan silinemedi:', err);
      }
      await legacy.removeItem(key).catch(() => {});
    },
  };
}
