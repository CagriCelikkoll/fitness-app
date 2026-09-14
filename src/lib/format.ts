/**
 * Tarih / süre / sayı biçimlendirme yardımcıları.
 *
 * Bu fonksiyonların kopyaları şu an app/(tabs)/index.tsx ve
 * app/session/active.tsx içinde de duruyor. Onları ayrı bir temizlik
 * turunda buraya taşıyacağız; yeni ekranlar doğrudan burayı kullanıyor.
 */

/** "Bugün" / "Dün" / "3 gün önce" / "12.05.2026" */
export function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return 'Bugün';
  if (diffDays === 1) return 'Dün';
  if (diffDays < 7) return `${diffDays} gün önce`;
  return date.toLocaleDateString('tr-TR');
}

/** "45 dk" / "1sa 12dk" */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}sa ${remainingMin}dk`;
}

/** "12.450 kg" — binlik ayraçlı */
export function formatVolume(kg: number): string {
  return `${Math.round(kg).toLocaleString('tr-TR')} kg`;
}

/** "12.05.2026 19:30" */
export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  const day = date.toLocaleDateString('tr-TR');
  const time = date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} ${time}`;
}
