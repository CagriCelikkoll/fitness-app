/**
 * Paylaşım kartı (0.13 Bölüm 3) — saf: kart verisi ve yazı boyutları.
 * Çizim `src/components/ShareCard.tsx`, görüntü + paylaşım
 * `src/lib/shareNative.ts` (react-native-view-shot + expo-sharing).
 *
 * - 1080 × 1920 (9:16, Instagram hikâyesi). Bütün ölçüler bu piksel
 *   biriminde; bileşen çizdiği genişliğe göre ölçekler.
 * - Yazılar Instagram'ın üst (~250 px: profil, ilerleme çubuğu) ve alt
 *   (~350 px: yanıt kutusu) arayüz alanlarının dışında (`SAFE_TOP`,
 *   `SAFE_BOTTOM`). Kapak görseli ve ışık kenarlara kadar.
 * - Kullanıcının adı, e-postası, kimliği karta yazılmaz: kart verisinde bu
 *   alanlar hiç yok (`test/shareCard.test.ts` denetliyor).
 * - Hiçbir şey sunucuya gitmez; görüntü geçici dosyada, paylaşım bitince
 *   silinir.
 */

import type { BodyContext, ContextExercise } from '@/lib/contextColor';
import { contextColorFor } from '@/lib/contextColor';
import { formatDecimal } from '@/lib/format';
import { durationShort, groupThousands } from '@/lib/progressStats';
import {
  recordBadgeText,
  recordComparison,
  recordHeadlineParts,
  recordMoreText,
  type RecordPageData,
} from '@/lib/recordEvents';
import type { SummaryRecord } from '@/lib/workoutSummary';

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1920;
/** Instagram hikâyesinin üst arayüz alanı (yazı yok) */
export const SAFE_TOP = 250;
/** Instagram hikâyesinin alt arayüz alanı (yazı yok) */
export const SAFE_BOTTOM = 350;
/** Yan kenar boşluğu */
export const SIDE_PADDING = 88;
/** Yazı alanının genişliği */
export const TEXT_WIDTH = SHARE_CARD_WIDTH - 2 * SIDE_PADDING;

export const SHARE_FOOTER = "Dinç · Google Play'de ücretsiz";

/** Kartta en fazla kaç rekor satırı; kalanı "+N rekor daha" */
export const MAX_RECORD_LINES = 3;

export interface RecordShareCard {
  kind: 'record';
  cover: 'rekor';
  /** "EN AĞIR KİLO · TAHMİNİ 1RM" */
  kindsText: string;
  exerciseName: string;
  exerciseNameSize: number;
  /** ["80 kg ", "× 5"] */
  headline: [string, string];
  headlineSize: number;
  /** "Önceki en iyiye göre +5 kg"; fark görünmüyorsa null */
  gainLine: string | null;
  /** "+2 rekor daha" */
  moreText: string | null;
}

export interface ShareStat {
  label: string;
  value: string;
}

export interface WorkoutShareCard {
  kind: 'workout';
  title: string;
  titleSize: number;
  /** Bağlam ışığının rengi */
  context: BodyContext;
  /** Süre, hacim, set; kardiyoda süre ve mesafe */
  stats: ShareStat[];
  /** "Göğüs Presi · 85 kg × 5" */
  records: string[];
  moreRecords: string | null;
}

export type ShareCardData = RecordShareCard | WorkoutShareCard;

// ── Yazı boyutu ─────────────────────────────────────────────────────────

/** Ortalama karakter genişliği / yazı boyutu (Display font, kabaca) */
const CHAR_WIDTH_RATIO = 0.6;

/**
 * Metnin tek satırda (ya da `lines` satırda) sığacağı en büyük boyut,
 * verilen basamaklardan. En küçük basamağın altına inilmez.
 */
export function fitFontSize(text: string, sizes: readonly number[], width = TEXT_WIDTH, lines = 1): number {
  const length = Math.max(1, [...text].length);
  for (const size of sizes) {
    const perLine = Math.floor(width / (size * CHAR_WIDTH_RATIO));
    if (Math.ceil(length / perLine) <= lines) return size;
  }
  return sizes[sizes.length - 1]!;
}

/** Dev rekor yazısı: "80 kg × 5" */
export const HEADLINE_SIZES = [168, 150, 132, 116, 100, 88] as const;
/** Hareket adı (2 satıra kadar) */
export const EXERCISE_NAME_SIZES = [72, 62, 54, 46] as const;
/** Rutin adı (2 satıra kadar) */
export const TITLE_SIZES = [104, 88, 74, 62, 52] as const;

// ── Kart verisi ─────────────────────────────────────────────────────────

/** Rekor kartı (rekor sayfasındaki veriden) */
export function recordShareCard(page: RecordPageData): RecordShareCard {
  const headline = recordHeadlineParts(page);
  const comparison = recordComparison(page);
  const unit = comparison.metricLabel === 'Tahmini 1RM' ? 'Tahmini 1RM ' : '';
  return {
    kind: 'record',
    cover: 'rekor',
    kindsText: recordBadgeText(page.kinds),
    exerciseName: page.exerciseName,
    exerciseNameSize: fitFontSize(page.exerciseName, EXERCISE_NAME_SIZES, TEXT_WIDTH, 2),
    headline,
    headlineSize: fitFontSize(headline.join(''), HEADLINE_SIZES),
    gainLine: comparison.gain != null ? `Önceki en iyiye göre ${unit}${comparison.gain} kg` : null,
    moreText: recordMoreText(page.moreCount),
  };
}

export interface WorkoutShareInput {
  name: string;
  durationSeconds: number | null;
  volumeKg: number;
  completedSets: number;
  records: readonly Pick<SummaryRecord, 'exerciseName' | 'weightKg' | 'reps'>[];
  /** Kardiyo bölümlerinin toplamı */
  cardioSeconds: number;
  cardioDistanceKm: number;
  /** Bağlam rengi için hareketler */
  exercises: readonly ContextExercise[];
}

/** Antrenman kartı (özet / ayrıntı verisinden) */
export function workoutShareCard(input: WorkoutShareInput): WorkoutShareCard {
  const stats: ShareStat[] = [];
  if (input.durationSeconds != null && input.durationSeconds > 0) {
    stats.push({ label: 'Süre', value: durationShort(input.durationSeconds) });
  }
  const strength = input.completedSets > 0;
  if (strength && input.volumeKg > 0) stats.push({ label: 'Hacim', value: `${groupThousands(input.volumeKg)} kg` });
  if (strength) stats.push({ label: 'Set', value: String(input.completedSets) });
  if (input.cardioDistanceKm > 0) stats.push({ label: 'Mesafe', value: `${formatDecimal(input.cardioDistanceKm, 2)} km` });
  if (!strength && input.cardioSeconds > 0 && !stats.some((s) => s.label === 'Süre')) {
    stats.push({ label: 'Kardiyo', value: durationShort(input.cardioSeconds) });
  }

  const lines = input.records.map(
    (r) => `${r.exerciseName} · ${formatDecimal(r.weightKg, 2)} kg × ${r.reps}`
  );
  const extra = lines.length - MAX_RECORD_LINES;
  return {
    kind: 'workout',
    title: input.name,
    titleSize: fitFontSize(input.name, TITLE_SIZES, TEXT_WIDTH, 2),
    context: contextColorFor(input.exercises),
    stats: stats.slice(0, 3),
    records: lines.slice(0, MAX_RECORD_LINES),
    moreRecords: extra > 0 ? recordMoreText(extra) : null,
  };
}

/** Paylaşım sayfasındaki erişilebilirlik / önizleme metni */
export function shareCardLabel(card: ShareCardData): string {
  if (card.kind === 'record') {
    return `Rekor kartı: ${card.exerciseName}, ${card.headline.join('').trim()}`;
  }
  return `Antrenman kartı: ${card.title}${card.stats.map((s) => `, ${s.label} ${s.value}`).join('')}`;
}
