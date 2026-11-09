/**
 * Karşılamanın görselli üç sayfası (v4.0b Bölüm 3) — saf: metinler, başlık
 * boyutu ve görselin yüksekliği. Çizim `src/components/OnboardingIntro.tsx`.
 */

import type { CoverKey } from '@/lib/coverImage';

export type IntroOverlay = 'set-saved' | 'progress-chart';

export interface IntroPage {
  cover: CoverKey;
  /** Başlığın satırları; satırlar elle bölünmüş, kelime ortasından kırılmaz */
  title: readonly string[];
  /** Vurgu renginde devam eden satırlar */
  accent: readonly string[];
  /** En geniş satır, Archivo Expanded ExtraBold'da ölçüldü (em) */
  widestLineEm: number;
  body: string;
  cta: string;
  overlay: IntroOverlay | null;
}

export const INTRO_PAGES: readonly IntroPage[] = [
  {
    cover: 'karsilama',
    title: ['HER SET', 'KAYITTA.'],
    accent: ['HER HAFTA', 'DAHA GÜÇLÜ.'],
    widestLineEm: 9.09,
    body: 'Antrenmanını saniyeler içinde kaydet, gelişimini gör. Hesap açmadan da kullanabilirsin.',
    cta: 'Başlayalım',
    overlay: null,
  },
  {
    cover: 'karsilama-2-kayit',
    title: ['SETLER', 'ARASINDA'],
    accent: ['TEK DOKUNUŞ.'],
    widestLineEm: 10,
    body: 'Geçen seferin kilosu ve tekrarı hazır gelir. Aynısını yaptıysan sadece onayla; dinlenme sayacı kendiliğinden başlar.',
    cta: 'Devam',
    overlay: 'set-saved',
  },
  {
    cover: 'karsilama-3-gelisim',
    title: ['GELİŞİMİNİ'],
    accent: ['GÖR.'],
    widestLineEm: 7.12,
    body: 'Rekorların, haftalık hacmin ve kas haritan otomatik hesaplanır. Verilerin önce telefonunda kalır; istersen hesap açıp yedeklersin.',
    cta: 'Programımı seç',
    overlay: 'progress-chart',
  },
];

export const INTRO_TITLE_MAX = 40;

/** Harf aralığı ve yuvarlama payı: satır hiçbir ekranda alta taşmasın */
const TITLE_FIT = 0.97;

/**
 * En geniş satır genişliğe sığacak en büyük boyut. Telefonun yazı ölçeği
 * büyükse (`fontScale`) ekranda o kadar büyüyeceği için baştan küçültülür.
 */
export function introTitleSize(widestLineEm: number, width: number, fontScale = 1): number {
  return Math.min(INTRO_TITLE_MAX, Math.floor((width * TITLE_FIT) / widestLineEm / fontScale));
}

/** Başlığın başladığı yükseklik, görselin bu oranına denk gelir (`page` karartması) */
export const INTRO_TEXT_OFFSET = 0.72;

/**
 * Görsel, yazının üstünden başlayacak kadar uzun: kısa ekranda yazı
 * karartmasız kısmın üstüne binmesin.
 */
export function introCoverHeight(textTop: number): number {
  return Math.round(textTop / INTRO_TEXT_OFFSET);
}
