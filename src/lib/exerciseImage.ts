/**
 * Free Exercise DB GitHub'da hostlanan görsellerin URL'lerini üretir.
 *
 * İleride bunları kendi Cloudflare R2 CDN'ine taşıyacağız ve burayı
 * tek bir noktadan değiştireceğiz. Şu an doğrudan GitHub'dan çekiyoruz
 * (geliştirme için yeterli, production için R2'ye geçilecek).
 */

const GITHUB_BASE =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

// İleride: const CDN_BASE = 'https://cdn.fitnesstracker.app/exercises';

/**
 * Image path JSON array string'inden tam URL listesi üretir.
 * @param imagePaths - schema'daki exercises.image_paths alanı (JSON string)
 */
export function getExerciseImageUrls(imagePaths: string | null): string[] {
  if (!imagePaths) return [];
  try {
    const paths: string[] = JSON.parse(imagePaths);
    return paths.map((p) => `${GITHUB_BASE}/${p}`);
  } catch {
    return [];
  }
}

/**
 * Tek bir görsel URL'i — tipik olarak ilk görseli kullanırız (kapak için).
 */
export function getExerciseCoverUrl(imagePaths: string | null): string | null {
  const urls = getExerciseImageUrls(imagePaths);
  return urls[0] ?? null;
}
