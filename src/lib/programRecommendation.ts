/**
 * Program önerisi (v3.8): önce hedef, sonra haftalık gün sayısı.
 *
 * - Hızlı gelişim: her kas grubu haftada 2 kez, kas başına ~10–16 set,
 *   RIR 1–2.
 * - Formu koru / istikrarlı ilerle: haftada 1–2 kez, ~6–10 set, RIR 2–3,
 *   seans başına daha az hareket.
 *
 * Bölgesel split (göğüs günü, kol günü…) hiçbir gün sayısında ana öneri
 * değil; 5 ve 6 günde ana önerinin altında "Alternatif" olarak çıkar.
 * Bölgesel split şablonları hazır programlar listesinde durur.
 *
 * Kart metnindeki sıklık, set ve süre şablondan hesaplanıyor (elle
 * yazılmıyor): şablon değişirse metin de değişir. Kas grubu hareketin ana
 * kasından (`exercises.json` `primaryMuscles[0]`); eşleme
 * `TEMPLATE_PRIMARY_MUSCLE`, test JSON'la karşılaştırıyor.
 *
 * Hedef seçimi yalnızca öneriyi etkiler; cihazda kv-store'da
 * (`RECOMMENDATION_GOAL_KEY`), sunucuya gitmez.
 */

import type { KeyValueStore } from '@/lib/onboarding';
import {
  getTemplate,
  type TemplateDay,
  type WorkoutTemplate,
} from '@/lib/workoutTemplates';

export type TrainingGoal = 'fast' | 'steady';

export const RECOMMENDATION_GOAL_KEY = 'recommendation.goal';

export const GOAL_OPTIONS: {
  id: TrainingGoal;
  title: string;
  subtitle: string;
  detail: string;
}[] = [
  {
    id: 'fast',
    title: 'Hızlı gelişim',
    subtitle: 'Kas ve güç kazanmaya odaklan',
    detail: 'Her kas grubu haftada 2 kez · kas başına ~10–16 set · RIR 1–2',
  },
  {
    id: 'steady',
    title: 'Formu koru / istikrarlı ilerle',
    subtitle: 'Daha kısa seanslar, sürdürülebilir tempo',
    detail: 'Her kas grubu haftada 1–2 kez · kas başına ~6–10 set · RIR 2–3',
  },
];

export type DaysPerWeek = 2 | 3 | 4 | 5 | 6;

export const DAY_OPTIONS: DaysPerWeek[] = [2, 3, 4, 5, 6];

/** Sıklık ve set hesabındaki büyük kas grupları */
export type MajorGroup = 'chest' | 'back' | 'shoulders' | 'quads' | 'hamstrings';

export const MAJOR_GROUPS: MajorGroup[] = ['chest', 'back', 'shoulders', 'quads', 'hamstrings'];

/**
 * `exercises.json` ana kası → büyük grup. Kol, baldır, karın ve ön kol
 * hesaba girmiyor (null). Trapez omuzla, kalça arka bacakla birlikte.
 */
export function majorGroupOf(primaryMuscle: string): MajorGroup | null {
  switch (primaryMuscle) {
    case 'chest':
      return 'chest';
    case 'lats':
    case 'middle back':
    case 'lower back':
      return 'back';
    case 'shoulders':
    case 'traps':
      return 'shoulders';
    case 'quadriceps':
      return 'quads';
    case 'hamstrings':
    case 'glutes':
      return 'hamstrings';
    default:
      return null;
  }
}

/**
 * Şablonlardaki hareketlerin ana kası (`exercises.json` ile aynı; test
 * denetliyor). Face pull istisna: çekiş hareketi, arka omuz ve üst sırt —
 * "Arka zincir" tanımıyla uyumlu olsun diye sırtta sayılıyor.
 */
export const TEMPLATE_PRIMARY_MUSCLE: Record<string, string> = {
  'Barbell_Bench_Press_-_Medium_Grip': 'chest',
  Incline_Dumbbell_Press: 'chest',
  Dumbbell_Bench_Press: 'chest',
  Leverage_Chest_Press: 'chest',
  'Dips_-_Chest_Version': 'chest',
  Cable_Crossover: 'chest',
  Butterfly: 'chest',
  'Wide-Grip_Lat_Pulldown': 'lats',
  'V-Bar_Pulldown': 'lats',
  'Close-Grip_Front_Lat_Pulldown': 'lats',
  'Straight-Arm_Pulldown': 'lats',
  Seated_Cable_Rows: 'middle back',
  Bent_Over_Barbell_Row: 'middle back',
  'One-Arm_Dumbbell_Row': 'middle back',
  Barbell_Deadlift: 'lower back',
  Face_Pull: 'middle back',
  Dumbbell_Shoulder_Press: 'shoulders',
  Machine_Shoulder_Military_Press: 'shoulders',
  Barbell_Shoulder_Press: 'shoulders',
  Side_Lateral_Raise: 'shoulders',
  Front_Dumbbell_Raise: 'shoulders',
  Reverse_Machine_Flyes: 'shoulders',
  Barbell_Shrug: 'traps',
  Barbell_Squat: 'quadriceps',
  Leg_Press: 'quadriceps',
  Hack_Squat: 'quadriceps',
  Split_Squat_with_Dumbbells: 'quadriceps',
  Leg_Extensions: 'quadriceps',
  Romanian_Deadlift: 'hamstrings',
  Lying_Leg_Curls: 'hamstrings',
  Seated_Leg_Curl: 'hamstrings',
  Barbell_Hip_Thrust: 'glutes',
  Barbell_Curl: 'biceps',
  'EZ-Bar_Curl': 'biceps',
  Hammer_Curls: 'biceps',
  Preacher_Curl: 'biceps',
  Incline_Dumbbell_Curl: 'biceps',
  Triceps_Pushdown: 'triceps',
  'Triceps_Pushdown_-_Rope_Attachment': 'triceps',
  Triceps_Overhead_Extension_with_Rope: 'triceps',
  'EZ-Bar_Skullcrusher': 'triceps',
  'Close-Grip_Barbell_Bench_Press': 'triceps',
  Standing_Calf_Raises: 'calves',
  Seated_Calf_Raise: 'calves',
  Hanging_Leg_Raise: 'abdominals',
  Cable_Crunch: 'abdominals',
};

function dayGroups(day: TemplateDay): Map<MajorGroup, number> {
  const sets = new Map<MajorGroup, number>();
  for (const e of day.exercises) {
    const muscle = TEMPLATE_PRIMARY_MUSCLE[e.exerciseId];
    const group = muscle ? majorGroupOf(muscle) : null;
    if (group) sets.set(group, (sets.get(group) ?? 0) + e.sets);
  }
  return sets;
}

/** Haftalık plan: şablonun hangi günleri hangi sırayla (A / B / A → [0, 1, 0]) */
export type WeekSchedule = readonly number[];

/** Her büyük kas grubunun haftada kaç seansta çalıştığı */
export function weeklyMuscleFrequency(
  template: WorkoutTemplate,
  schedule: WeekSchedule
): Record<MajorGroup, number> {
  const result = Object.fromEntries(MAJOR_GROUPS.map((g) => [g, 0])) as Record<MajorGroup, number>;
  for (const i of schedule) {
    for (const group of dayGroups(template.days[i]!).keys()) result[group]++;
  }
  return result;
}

/** Her büyük kas grubunun haftalık set sayısı (ana kasa göre) */
export function weeklyMuscleSets(
  template: WorkoutTemplate,
  schedule: WeekSchedule
): Record<MajorGroup, number> {
  const result = Object.fromEntries(MAJOR_GROUPS.map((g) => [g, 0])) as Record<MajorGroup, number>;
  for (const i of schedule) {
    for (const [group, sets] of dayGroups(template.days[i]!)) result[group] += sets;
  }
  return result;
}

/** Set başına çalışma süresi (sn); dinlenme şablondan */
const WORK_SECONDS_PER_SET = 40;

/** Isınma ve hareket arası hazırlık (dk) */
const WARMUP_MINUTES = 5;

/**
 * Seans süresi tahmini (dk, 5'e yuvarlı): ısınma + setler × (çalışma +
 * dinlenme)
 */
export function sessionMinutes(day: TemplateDay): number {
  const seconds =
    WARMUP_MINUTES * 60 +
    day.exercises.reduce((sum, e) => sum + e.sets * (WORK_SECONDS_PER_SET + e.restSeconds), 0);
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}

interface PlanSpec {
  templateId: string;
  schedule: WeekSchedule;
  /** Kartın "neden" cümlesi */
  why: string;
}

const PLANS: Record<TrainingGoal, Record<DaysPerWeek, PlanSpec>> = {
  fast: {
    2: {
      templateId: 'fb-ab',
      schedule: [0, 1],
      why: 'Haftada 2 günle her kası iki kez çalıştırmanın yolu: her seans bütün vücut.',
    },
    3: {
      templateId: 'fb-ab',
      schedule: [0, 1, 0],
      why: 'A / B / A, sonraki hafta B / A / B: her kas sık ve dengeli çalışır.',
    },
    4: {
      templateId: 'upper-lower',
      schedule: [0, 1, 2, 3],
      why: '4 gün için en dengeli seçenek: üst ve alt vücut ikişer kez.',
    },
    5: {
      templateId: 'ul-ppl',
      schedule: [0, 1, 2, 3, 4],
      why: 'Beşinci gün sıklığı bozmadan hacim ekler: üst / alt, sonra itme / çekme / bacak.',
    },
    6: {
      templateId: 'ppl',
      schedule: [0, 1, 2, 0, 1, 2],
      why: 'İtme, çekme ve bacak ikişer kez: 6 gün için klasik ve dengeli.',
    },
  },
  steady: {
    2: {
      templateId: 'ant-post',
      schedule: [0, 1],
      why: 'Bir gün ön, bir gün arka zincir: kısa haftada bütün vücut.',
    },
    3: {
      templateId: 'ppl',
      schedule: [0, 1, 2],
      why: 'Her gün farklı bir hareket kalıbı, toparlanmaya bol zaman.',
    },
    4: {
      templateId: 'ant-post-4',
      schedule: [0, 1, 2, 3],
      why: 'Ön ve arka zincir ikişer kez, seanslar kısa.',
    },
    5: {
      templateId: 'ul-fb',
      schedule: [0, 1, 2, 3, 4],
      why: 'Üst ve alt vücut ikişer kez, araya hafif bir full body günü.',
    },
    // 6 gün bu hedef için önerilmez: 4 gün önerilir (SIX_DAYS_STEADY_NOTICE)
    6: {
      templateId: 'ant-post-4',
      schedule: [0, 1, 2, 3],
      why: 'Ön ve arka zincir ikişer kez, seanslar kısa.',
    },
  },
};

export const SIX_DAYS_STEADY_NOTICE =
  'Bu hedef için 6 gün gerekmiyor: aynı ilerlemeyi 4 günde, toparlanmaya yer bırakarak alırsın. Kalan günlerde yürüyüş ya da hafif kardiyo yapabilirsin.';

/** Bölgesel split şablonları: ana öneri olmaz, 5–6 günde alternatif */
export const REGIONAL_SPLIT_IDS: readonly string[] = ['split4', 'split5'];

const ALTERNATIVE: PlanSpec = {
  templateId: 'split5',
  schedule: [0, 1, 2, 3, 4],
  why: 'Her kas grubu haftada 1 kez · tecrübeli sporcular için',
};

export const ALTERNATIVE_TITLE = 'Alternatif: Klasik bölgesel split';

export const CHAIN_EXPLANATION =
  'Ön: göğüs, ön omuz, quadriceps, karın. Arka: sırt, arka omuz, hamstring, kalça.';

export interface RecommendedProgram {
  template: WorkoutTemplate;
  schedule: WeekSchedule;
  /** Haftada kaç antrenman (haftalık hedefe de bu yazılır) */
  daysPerWeek: number;
  /** "A · B · A" */
  scheduleLabel: string;
  /** "Her kas grubu haftada 2 kez · seans ~60 dk · kas başına ~12 set" */
  summary: string;
  why: string;
  isRegionalSplit: boolean;
  /** Ön / arka zincir programında kısa açıklama */
  chainNote: string | null;
}

export interface ProgramRecommendation {
  main: RecommendedProgram;
  /** Yalnızca 5 ve 6 günde: klasik bölgesel split */
  alternative: RecommendedProgram | null;
  /** İstenen gün önerilmiyorsa nedeni (formu koru + 6 gün) */
  notice: string | null;
}

function range(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(min) : `${min}–${max}`;
}

function build(spec: PlanSpec): RecommendedProgram {
  const template = getTemplate(spec.templateId);
  if (!template) throw new Error(`Şablon yok: ${spec.templateId}`);
  const freq = Object.values(weeklyMuscleFrequency(template, spec.schedule));
  const sets = Object.values(weeklyMuscleSets(template, spec.schedule));
  const avgSets = Math.round(sets.reduce((a, b) => a + b, 0) / sets.length);
  const minutes = spec.schedule.map((i) => sessionMinutes(template.days[i]!));
  const avgMinutes = Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length / 5) * 5;
  return {
    template,
    schedule: spec.schedule,
    daysPerWeek: spec.schedule.length,
    scheduleLabel: spec.schedule.map((i) => template.days[i]!.name).join(' · '),
    summary: `Her kas grubu haftada ${range(freq)} kez · seans ~${avgMinutes} dk · kas başına ~${avgSets} set`,
    why: spec.why,
    isRegionalSplit: REGIONAL_SPLIT_IDS.includes(template.id),
    chainNote: template.id.startsWith('ant-post') ? CHAIN_EXPLANATION : null,
  };
}

export function recommendProgram(goal: TrainingGoal, days: DaysPerWeek): ProgramRecommendation {
  return {
    main: build(PLANS[goal][days]),
    alternative: days >= 5 ? build(ALTERNATIVE) : null,
    notice: goal === 'steady' && days === 6 ? SIX_DAYS_STEADY_NOTICE : null,
  };
}

export function parseGoal(raw: string | null): TrainingGoal | null {
  return raw === 'fast' || raw === 'steady' ? raw : null;
}

export async function getRecommendationGoal(store: KeyValueStore): Promise<TrainingGoal | null> {
  return parseGoal(await store.getItem(RECOMMENDATION_GOAL_KEY));
}

export async function setRecommendationGoal(store: KeyValueStore, goal: TrainingGoal): Promise<void> {
  await store.setItem(RECOMMENDATION_GOAL_KEY, goal);
}
