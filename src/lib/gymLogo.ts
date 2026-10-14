/**
 * Salon logosu (v3.3) — Supabase Storage `gym-logos` bucket'ı.
 *
 * - Yol: `<gym_id>/<rastgele>.jpg`. Her yüklemede yeni ad: adres değişir,
 *   telefonlardaki önbellek eski logoyu göstermez. Eski dosya yeni logo
 *   kaydedildikten sonra silinir.
 * - Okuma herkese açık (kalıcı adres, önbelleğe uygun); yazma / silme
 *   yalnızca o salonun yöneticisi (0009_push.sql).
 * - `gyms.logo_url` yalnızca kendi salonunun klasöründeki dosyayı
 *   gösterebilir (sunucu kısıtı).
 *
 * Resmi seçme, kırpma ve küçültme `gymLogoNative.ts`'te.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';

export const GYM_LOGO_BUCKET = 'gym-logos';
/** Kenar uzunluğu üst sınırı (px) */
export const GYM_LOGO_SIZE = 512;
/** Bucket sınırıyla aynı */
export const GYM_LOGO_MAX_BYTES = 512 * 1024;

/** Kare olmayan resmin ortasından en büyük kare */
export function centerSquare(width: number, height: number): {
  originX: number;
  originY: number;
  width: number;
  height: number;
} {
  const side = Math.min(width, height);
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}

export function logoObjectPath(gymId: string, fileId: string): string {
  return `${gymId}/${fileId}.jpg`;
}

/** Kendi salonunun logosu ise bucket içindeki yol; değilse null */
export function logoPathFromUrl(url: string | null | undefined, gymId: string): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${GYM_LOGO_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const path = url.slice(i + marker.length).split(/[?#]/)[0];
  return path.startsWith(`${gymId}/`) ? path : null;
}

/** Logo yoksa yerine: salon adının baş harfi (Türkçe büyük harf) */
export function gymInitial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase('tr') : '?';
}

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return { ok: false, error: accountError('not_configured') };
  try {
    return await fn(client);
  } catch (e) {
    console.error('[GYM-LOGO] HATA:', e);
    return { ok: false, error: toAccountError(e) };
  }
}

const fail = <T>(e: unknown): AccountResult<T> => ({ ok: false, error: toAccountError(e) });

async function setLogoUrl(c: SupabaseClient, gymId: string, url: string | null): Promise<AccountResult<null>> {
  const { data, error } = await c.from('gyms').update({ logo_url: url }).eq('id', gymId).select('id');
  if (error) return fail(error);
  return Array.isArray(data) && data.length > 0 ? { ok: true, value: null } : { ok: false, error: accountError('forbidden') };
}

async function removeObject(c: SupabaseClient, path: string | null): Promise<void> {
  if (!path) return;
  const { error } = await c.storage.from(GYM_LOGO_BUCKET).remove([path]);
  if (error) console.warn('[GYM-LOGO] Eski logo silinemedi:', error.message);
}

/**
 * Yükle → `logo_url`'yi güncelle → eski dosyayı sil. Güncelleme olmazsa
 * yüklenen dosya geri silinir. Değer: yeni adres.
 */
export function uploadGymLogo(
  client: SupabaseClient | null,
  gymId: string,
  bytes: ArrayBuffer | Uint8Array,
  fileId: string,
  previousUrl: string | null
) {
  return run<string>(client, async (c) => {
    if (bytes.byteLength > GYM_LOGO_MAX_BYTES) return { ok: false, error: accountError('invalid_input') };
    const path = logoObjectPath(gymId, fileId);
    const bucket = c.storage.from(GYM_LOGO_BUCKET);
    const { error: upErr } = await bucket.upload(path, bytes, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
    if (upErr) return fail(upErr);
    const url = bucket.getPublicUrl(path).data.publicUrl;
    const saved = await setLogoUrl(c, gymId, url);
    if (!saved.ok) {
      await removeObject(c, path);
      return saved;
    }
    await removeObject(c, logoPathFromUrl(previousUrl, gymId));
    return { ok: true, value: url };
  });
}

/** Logoyu kaldır: `logo_url` boş, dosya silinir */
export function removeGymLogo(client: SupabaseClient | null, gymId: string, currentUrl: string | null) {
  return run<null>(client, async (c) => {
    const saved = await setLogoUrl(c, gymId, null);
    if (!saved.ok) return saved;
    await removeObject(c, logoPathFromUrl(currentUrl, gymId));
    return { ok: true, value: null };
  });
}
