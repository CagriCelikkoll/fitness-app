import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';

import { useDb } from '@/hooks/useDb';
import { appSettings, type AppSettings } from '@/db/schema';

/**
 * `app_settings` tek satırını (id = 1) canlı okur.
 *
 * Ayarlar birden çok ekranda gerektiği için (rutin editörü öntanımlı
 * dinlenme süresini, dinlenme zamanlayıcısı ve set satırı titreşim
 * tercihini okuyor) aynı sorgu her yerde tekrarlanmasın diye burada.
 *
 * useLiveQuery kullanıyor: Ayarlar sekmesinde bir anahtar değiştiğinde
 * açık ekranlar yeniden sorgu yapmadan güncel değeri görür.
 *
 * `loaded` ilk sorgu dönmeden true olmaz; çağıran taraf o ana kadar
 * fallback değerleri kullanmalı (ayar satırı seed'de oluşuyor ama
 * sorgu asenkron).
 */
export function useAppSettings(): {
  settings: AppSettings | undefined;
  loaded: boolean;
} {
  const db = useDb();

  const { data, updatedAt } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1)
  );

  return { settings: data?.[0], loaded: updatedAt != null };
}

/** Ayar okunamadığında kullanılacak öntanımlı dinlenme süresi (saniye) */
export const FALLBACK_REST_SECONDS = 90;

/** Ayar okunamadığında titreşim açık kabul edilir (şema varsayılanı) */
export const FALLBACK_REST_VIBRATE = true;
