/**
 * İlerleme ekranı (v4.0a Bölüm 4) — saf hesaplar ve tek okuma.
 *
 * - Hafta / Ay / Yıl seçici: 2×2 kart içinde bulunulan dönemin değerini
 *   gösterir (bu hafta, bu ay, bu yıl), bir önceki dönemle karşılaştırır.
 * - Grafik seçili metriğin son 8 hafta / 6 ay / 12 ay çubukları.
 * - Metrikler: toplam hacim (kg), antrenman (farklı gün), süre, rekor (bir
 *   antrenmanda rekor kıran hareket sayısı; ilk seans sayılmaz).
 *
 * Yalnızca bitmiş antrenmanlar; hacimde tamamlanmış normal setler. Tarihler
 * yerel saatle; hafta Pazartesi başlar.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { sessionExercises, sets, workoutSessions } from '@/db/schema';
import { LOWER_MUSCLES, UPPER_MUSCLES } from '@/lib/contextColor';
import { SHORT_MONTHS_TR, toDateKey } from '@/lib/format';
import { loadRecordHistory, recordEvents } from '@/lib/recordEvents';
import { startOfWeek } from '@/lib/weeklyVolume';

export type ProgressPeriod = 'week' | 'month' | 'year';
export type ProgressMetric = 'volume' | 'workouts' | 'duration' | 'records';

export const PROGRESS_PERIODS: readonly { key: ProgressPeriod; label: string }[] = [
  { key: 'week', label: 'Hafta' },
  { key: 'month', label: 'Ay' },
  { key: 'year', label: 'Yıl' },
];

export const PROGRESS_METRICS: readonly ProgressMetric[] = ['volume', 'workouts', 'duration', 'records'];

/** Çubuk sayısı: son 8 hafta / 6 ay / 12 ay */
export const CHART_BARS: Record<ProgressPeriod, number> = { week: 8, month: 6, year: 12 };

export interface ProgressSession {
  startedAt: string;
  durationSeconds: number | null;
  volume: number;
}

export interface ProgressRecord {
  sessionId: string;
  exerciseId: string;
  /** Seans başlangıcı (ISO) */
  at: string;
}

export interface ProgressData {
  sessions: readonly ProgressSession[];
  records: readonly ProgressRecord[];
}

// ── Dönemler ────────────────────────────────────────────────────────────

export interface Range {
  start: Date;
  /** Hariç */
  end: Date;
}

/** Bulunulan dönem (`offset` 0) ya da öncekiler (−1, −2 …) */
export function periodRange(period: ProgressPeriod, now: Date, offset = 0): Range {
  if (period === 'week') {
    const monday = startOfWeek(now);
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7 * offset);
    return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
  }
  const start = new Date(now.getFullYear() + offset, 0, 1);
  return { start, end: new Date(start.getFullYear() + 1, 0, 1) };
}

export interface ChartBucket extends Range {
  key: string;
  /** "21 Eyl" (hafta) / "Eyl" (ay) */
  label: string;
}

/** Grafiğin çubukları, eskiden yeniye: haftalar ya da aylar (yıl = 12 ay) */
export function chartBuckets(period: ProgressPeriod, now: Date): ChartBucket[] {
  const n = CHART_BARS[period];
  const out: ChartBucket[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const r = period === 'week' ? periodRange('week', now, -i) : periodRange('month', now, -i);
    const label =
      period === 'week'
        ? `${r.start.getDate()} ${SHORT_MONTHS_TR[r.start.getMonth()]}`
        : SHORT_MONTHS_TR[r.start.getMonth()]!;
    out.push({ ...r, key: toDateKey(r.start), label });
  }
  return out;
}

// ── Metrikler ───────────────────────────────────────────────────────────

const inRange = (iso: string, r: Range) => {
  const t = new Date(iso).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
};

/** Dönemdeki ham değer: kg, gün, saniye, rekor */
export function metricValue(metric: ProgressMetric, data: ProgressData, r: Range): number {
  if (metric === 'records') {
    const seen = new Set<string>();
    for (const e of data.records) if (inRange(e.at, r)) seen.add(`${e.sessionId}|${e.exerciseId}`);
    return seen.size;
  }
  const list = data.sessions.filter((s) => inRange(s.startedAt, r));
  if (metric === 'workouts') return new Set(list.map((s) => toDateKey(new Date(s.startedAt)))).size;
  if (metric === 'duration') return list.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  return list.reduce((sum, s) => sum + (Number(s.volume) || 0), 0);
}

// ── Biçim ───────────────────────────────────────────────────────────────

/** 72480 → "72.480" (Hermes'te yerel ayar farkı olmasın diye elle) */
export function groupThousands(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Saniye → "9 sa 40" / "53 dk" / "0 dk" */
export function durationShort(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} sa` : `${h} sa ${m}`;
}

/** Saniye → "9 saat 40 dakika" (ekran okuyucu) */
export function durationSpoken(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} dakika`;
  return m === 0 ? `${h} saat` : `${h} saat ${m} dakika`;
}

const PREV_WORD: Record<ProgressPeriod, string> = {
  week: 'geçen haftaya',
  month: 'geçen aya',
  year: 'geçen yıla',
};

const THIS_WORD: Record<ProgressPeriod, string> = { week: 'bu hafta', month: 'bu ay', year: 'bu yıl' };

/** Yüzde değişim: "↑ %9" / "↓ %5" / "= %0"; önceki dönem 0 ise null */
export function percentChange(current: number, previous: number): { text: string; spoken: string } | null {
  if (!(previous > 0)) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: '= %0', spoken: 'değişmedi' };
  return pct > 0
    ? { text: `↑ %${pct}`, spoken: `yüzde ${pct} arttı` }
    : { text: `↓ %${-pct}`, spoken: `yüzde ${-pct} azaldı` };
}

/** Fark: "↑ 2" / "↓ 1"; eşitse null */
export function countChange(current: number, previous: number): { text: string; spoken: string } | null {
  const d = current - previous;
  if (d === 0) return null;
  return d > 0 ? { text: `↑ ${d}`, spoken: `${d} fazla` } : { text: `↓ ${-d}`, spoken: `${-d} az` };
}

export interface StatView {
  metric: ProgressMetric;
  label: string;
  value: string;
  unit?: string;
  footnote: string;
  accessibilityLabel: string;
}

export const METRIC_LABELS: Record<ProgressMetric, string> = {
  volume: 'Toplam hacim',
  workouts: 'Antrenman',
  duration: 'Süre',
  records: 'Rekor',
};

/** 2×2 kartlar: bulunulan dönem ve öncekiyle karşılaştırma */
export function progressStats(data: ProgressData, period: ProgressPeriod, now: Date): StatView[] {
  const cur = periodRange(period, now);
  const prev = periodRange(period, now, -1);
  const prevWord = PREV_WORD[period];
  const thisWord = THIS_WORD[period];

  const volume = metricValue('volume', data, cur);
  const volChange = percentChange(volume, metricValue('volume', data, prev));

  const days = metricValue('workouts', data, cur);
  const dayChange = countChange(days, metricValue('workouts', data, prev));

  const seconds = metricValue('duration', data, cur);
  const sessionCount = data.sessions.filter((s) => inRange(s.startedAt, cur)).length;
  const avg = sessionCount > 0 ? seconds / sessionCount : null;

  const records = metricValue('records', data, cur);

  return [
    {
      metric: 'volume',
      label: METRIC_LABELS.volume,
      value: groupThousands(volume),
      unit: 'kg',
      footnote: volChange ? `${volChange.text} · ${prevWord} göre` : thisWord,
      accessibilityLabel: `Toplam hacim ${thisWord}: ${groupThousands(volume)} kilogram${
        volChange ? `, ${prevWord} göre ${volChange.spoken}` : ''
      }`,
    },
    {
      metric: 'workouts',
      label: METRIC_LABELS.workouts,
      value: String(days),
      unit: 'gün',
      footnote: dayChange ? `${dayChange.text} · ${prevWord} göre` : thisWord,
      accessibilityLabel: `Antrenman ${thisWord}: ${days} gün${dayChange ? `, ${prevWord} göre ${dayChange.spoken}` : ''}`,
    },
    {
      metric: 'duration',
      label: METRIC_LABELS.duration,
      value: durationShort(seconds),
      footnote: avg != null ? `ort. ${durationShort(avg)}` : thisWord,
      accessibilityLabel: `Süre ${thisWord}: ${durationSpoken(seconds)}${
        avg != null ? `, antrenman başına ortalama ${durationSpoken(avg)}` : ''
      }`,
    },
    {
      metric: 'records',
      label: METRIC_LABELS.records,
      value: String(records),
      footnote: thisWord,
      accessibilityLabel: `Rekor ${thisWord}: ${records}`,
    },
  ];
}

export interface ChartView {
  title: string;
  subtitle: string;
  bars: { key: string; value: number }[];
  startLabel: string;
  endLabel: string;
  /** Çubuk değerinin kısa biçimi (eksen etiketi) */
  format: (value: number) => string;
}

const CHART_TITLES: Record<ProgressMetric, [string, string]> = {
  volume: ['Haftalık hacim', 'Aylık hacim'],
  workouts: ['Haftalık antrenman', 'Aylık antrenman'],
  duration: ['Haftalık süre', 'Aylık süre'],
  records: ['Haftalık rekor', 'Aylık rekor'],
};

const SUBTITLES: Record<ProgressPeriod, string> = {
  week: 'son 8 hafta',
  month: 'son 6 ay',
  year: 'son 12 ay',
};

function axisFormat(metric: ProgressMetric): (v: number) => string {
  if (metric === 'volume') return (v) => `${groupThousands(v)} kg`;
  if (metric === 'duration') return (v) => durationShort(v);
  if (metric === 'workouts') return (v) => `${Math.round(v)} gün`;
  return (v) => String(Math.round(v));
}

export function progressChart(
  data: ProgressData,
  metric: ProgressMetric,
  period: ProgressPeriod,
  now: Date
): ChartView {
  const buckets = chartBuckets(period, now);
  return {
    title: CHART_TITLES[metric][period === 'week' ? 0 : 1]!,
    subtitle: SUBTITLES[period],
    bars: buckets.map((b) => ({ key: b.key, value: metricValue(metric, data, b) })),
    startLabel: buckets[0]!.label,
    endLabel: buckets[buckets.length - 1]!.label,
    format: axisFormat(metric),
  };
}

/** Kartın rengi (seçiliyken dolu) */
export const METRIC_COLORS = {
  volume: 'upper',
  workouts: undefined,
  duration: 'rest',
  records: 'record',
} as const satisfies Record<ProgressMetric, 'upper' | 'rest' | 'record' | undefined>;

// ── Okuma ───────────────────────────────────────────────────────────────

/** Bitmiş bütün antrenmanlar (süre, hacim) ve rekor geçmişi */
export async function loadProgressData(db: Db): Promise<ProgressData> {
  const sessionRows = await db
    .select({
      id: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
      durationSeconds: workoutSessions.durationSeconds,
    })
    .from(workoutSessions)
    .where(isNotNull(workoutSessions.endedAt));
  const volumes = await db
    .select({
      id: workoutSessions.id,
      volume: sql<number>`coalesce(sum(${sets.reps} * ${sets.weightKg}), 0)`,
    })
    .from(sets)
    .innerJoin(sessionExercises, eq(sets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .where(and(isNotNull(workoutSessions.endedAt), eq(sets.isCompleted, true), eq(sets.setType, 'normal')))
    .groupBy(workoutSessions.id);
  const volumeById = new Map(volumes.map((v) => [v.id, Number(v.volume) || 0]));
  const sessions: ProgressSession[] = sessionRows.map((s) => ({
    startedAt: s.startedAt,
    durationSeconds: s.durationSeconds,
    volume: volumeById.get(s.id) ?? 0,
  }));
  const records = recordEvents(await loadRecordHistory(db)).map((e) => ({
    sessionId: e.sessionId,
    exerciseId: e.exerciseId,
    at: e.at,
  }));
  return { sessions, records };
}

// ── Kas başına set ──────────────────────────────────────────────────────

export interface MuscleBar {
  muscle: string;
  sets: number;
  /** En çok çalışan kasa göre 0..1 */
  fraction: number;
  /** Üst / alt vücut; karın, core vb. null (nötr) */
  context: 'upper' | 'lower' | null;
}

/** En çok set yapılan kaslar (varsayılan 6), azalan */
export function muscleBars(volume: Readonly<Record<string, number>>, limit = 6): MuscleBar[] {
  const ranked = Object.entries(volume)
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .slice(0, limit);
  const top = ranked[0]?.[1] ?? 0;
  return ranked.map(([muscle, sets]) => ({
    muscle,
    sets,
    fraction: top > 0 ? sets / top : 0,
    context: UPPER_MUSCLES.has(muscle) ? 'upper' : LOWER_MUSCLES.has(muscle) ? 'lower' : null,
  }));
}
