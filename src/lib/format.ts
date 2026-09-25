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

/** Yerel saate göre "2026-09-14" — body_metrics.date formatı */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Gregoryen takvimde artık yıl mı */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Ayın gün sayısı (month: 1-12) */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 30 Şubat, 31 Nisan, artık olmayan yılda 29 Şubat gibi tarihleri eler */
export function isValidCalendarDate(
  year: number,
  month: number,
  day: number
): boolean {
  if (![year, month, day].every(Number.isInteger)) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** "2026-09-14" geçerli bir takvim günü mü */
export function isValidDateKey(key: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return false;
  return isValidCalendarDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  );
}

/** Tarih girişindeki ayrı alanlar — ham metin, kullanıcı yazdığı gibi */
export interface DateParts {
  day: string;
  month: string;
  year: string;
}

/** "2026-09-14" → { day: '14', month: '09', year: '2026' } */
export function dateKeyToParts(key: string): DateParts {
  const [year = '', month = '', day = ''] = key.split('-');
  return { day, month, year };
}

/**
 * { day: '5', month: '9', year: '2026' } → "2026-09-05".
 * Eksik ya da takvimde olmayan bir tarihse null.
 */
export function partsToDateKey(parts: DateParts): string | null {
  if (!/^\d{1,2}$/.test(parts.day)) return null;
  if (!/^\d{1,2}$/.test(parts.month)) return null;
  if (!/^\d{4}$/.test(parts.year)) return null;

  const [d, m, y] = [Number(parts.day), Number(parts.month), Number(parts.year)];
  if (!isValidCalendarDate(y, m, d)) return null;

  return `${parts.year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Tarih girişi için hata satırı; tarih yoksa null.
 *
 * Kullanıcı yazarken sürekli kırmızı görmesin diye üç alan da dolmadan
 * hata üretmez — ancak `submitted` ise (kaydet'e basıldıysa) eksik
 * tarih de bildirilir. İleri tarihler her zaman reddedilir.
 */
export function getDateInputError(
  parts: DateParts,
  options: { minYear: number; submitted: boolean; futureError?: string }
): string | null {
  const filled =
    parts.day.length > 0 && parts.month.length > 0 && parts.year.length === 4;
  if (!filled) {
    return options.submitted ? 'Tarihi gün / ay / yıl olarak eksiksiz gir.' : null;
  }

  const key = partsToDateKey(parts);
  if (key == null) return 'Takvimde böyle bir tarih yok.';
  if (Number(parts.year) < options.minYear) {
    return `Yıl ${options.minYear} veya sonrası olmalı.`;
  }
  if (key > toDateKey(new Date())) {
    return options.futureError ?? 'İleri bir tarih girilemez.';
  }
  return null;
}

/** Sayı klavyesi girişinden rakam dışındaki her şeyi atar */
export function digitsOnly(text: string): string {
  return text.replace(/\D/g, '');
}

/** Ondalık girişlerde varsayılan en fazla ondalık hane sayısı */
export const DEFAULT_MAX_DECIMAL_DIGITS = 1;

function decimalDigitCount(text: string): number {
  const sepIndex = text.search(/[.,]/);
  return sepIndex === -1 ? 0 : text.length - sepIndex - 1;
}

/**
 * Ondalık sayı girişini temizler: eksi işareti ve harfler atılır,
 * yalnızca rakam ve ondalık ayırıcı (virgül ya da nokta) kalır.
 * Tam sayı kısmı sınırsız.
 *
 * Şu girişler yok sayılır ve `previous` döner:
 * - ikinci bir ayırıcı ("1,2,3" → "1,23" kullanıcının fark etmeyeceği
 *   bir değer değişikliği olurdu)
 * - ondalık kısmı `maxDecimals` haneyi aşan giriş ("1,2" + "3")
 *
 * Kayıttan yüklenmiş, sınırdan fazla ondalıklı bir değer kırpılmaz;
 * ondalık hanesi artmadığı sürece düzenlenebilir (ör. hane silmek).
 */
export function sanitizeDecimalInput(
  text: string,
  previous: string,
  maxDecimals: number = DEFAULT_MAX_DECIMAL_DIGITS
): string {
  const cleaned = text.replace(/[^\d.,]/g, '');
  const separatorCount = (cleaned.match(/[.,]/g) ?? []).length;
  if (separatorCount > 1) return previous;

  const decimals = decimalDigitCount(cleaned);
  if (decimals > maxDecimals && decimals > decimalDigitCount(previous)) {
    return previous;
  }
  return cleaned;
}

/**
 * "2026-09-14" → "14.09.2026". new Date('YYYY-MM-DD') UTC olarak
 * yorumlandığı için parçalayarak yerel tarih kuruyoruz.
 */
export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-');
  if (!y || !m || !d) return key;
  return `${d}.${m}.${y}`;
}

/** "82,5" — en fazla `digits` ondalık */
export function formatDecimal(n: number, digits = 1): string {
  return n.toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** "+0,8 kg" / "−1,2 kg" / "0 kg" */
export function formatSignedKg(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return '0 kg';
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${formatDecimal(Math.abs(rounded))} kg`;
}

const SHORT_MONTHS_TR = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];

/**
 * ISO zaman damgası → "12 Eyl"; bu yıldan değilse "12 Eyl 2025".
 * Ay adları elle: Hermes'te Intl kısa ay adları cihaza göre değişebiliyor.
 */
export function formatShortDate(isoString: string, now: Date = new Date()): string {
  const date = new Date(isoString);
  const base = `${date.getDate()} ${SHORT_MONTHS_TR[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? base
    : `${base} ${date.getFullYear()}`;
}
