/**
 * "Videolu anlatım" — egzersiz için YouTube araması.
 *
 * Sabit video yerine arama: bağlantı kırılmaz, bakım ve telif derdi yok.
 * Veritabanındaki İngilizce ad ("Barbell Bench Press - Medium Grip")
 * aramada Türkçe addan çok daha isabetli sonuç veriyor.
 */
export function youtubeSearchUrl(exerciseName: string): string {
  const query = `${exerciseName} exercise form`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
