/**
 * Egzersiz verisindeki ham İngilizce değerlerin Türkçe karşılıkları ve
 * vücut bölgesi gruplaması.
 *
 * Saf modül: veritabanı ya da React bilmiyor. Sözlükler
 * `assets/seed/exercises.json` + `cardio-modes.json`'daki gerçek değerlere
 * göre dolduruldu; eksik kalırsa `test/exerciseTaxonomy.test.ts` patlar.
 *
 * Terminoloji: salonda yerleşmiş terimler (biceps, kettlebell,
 * powerlifting...) zorla çevrilmedi — amaç anlaşılırlık.
 */

export const MUSCLE_LABELS: Record<string, string> = {
  abdominals: 'Karın',
  abductors: 'Dış Bacak',
  adductors: 'İç Bacak',
  biceps: 'Biceps',
  calves: 'Baldır',
  chest: 'Göğüs',
  core: 'Core',
  forearms: 'Ön Kol',
  glutes: 'Kalça',
  hamstrings: 'Arka Bacak',
  lats: 'Kanat',
  'lower back': 'Bel',
  'middle back': 'Orta Sırt',
  neck: 'Boyun',
  quadriceps: 'Ön Bacak',
  shoulders: 'Omuz',
  traps: 'Trapez',
  triceps: 'Triceps',
};

export const EQUIPMENT_LABELS: Record<string, string> = {
  bands: 'Direnç Bandı',
  barbell: 'Halter',
  'body only': 'Vücut Ağırlığı',
  cable: 'Kablo',
  dumbbell: 'Dambıl',
  'e-z curl bar': 'Z Bar',
  'exercise ball': 'Pilates Topu',
  'foam roll': 'Foam Roller',
  kettlebells: 'Kettlebell',
  machine: 'Makine',
  'medicine ball': 'Sağlık Topu',
  none: 'Ekipmansız',
  other: 'Diğer',
  // cardio-modes.json
  bicycle: 'Bisiklet',
  'elliptical machine': 'Eliptik',
  'exercise bike': 'Kondisyon Bisikleti',
  pool: 'Havuz',
  'rowing machine': 'Kürek Makinesi',
  'stair climber': 'Merdiven Makinesi',
  treadmill: 'Koşu Bandı',
};

export const CATEGORY_LABELS: Record<string, string> = {
  cardio: 'Kardiyo',
  'olympic weightlifting': 'Olimpik Halter',
  plyometrics: 'Pliometrik',
  powerlifting: 'Powerlifting',
  strength: 'Güç',
  stretching: 'Esneklik',
  strongman: 'Strongman',
};

export const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Başlangıç',
  intermediate: 'Orta',
  expert: 'İleri',
};

export const FORCE_LABELS: Record<string, string> = {
  pull: 'Çekme',
  push: 'İtme',
  static: 'Statik',
};

export const MECHANIC_LABELS: Record<string, string> = {
  compound: 'Bileşik',
  isolation: 'İzolasyon',
};

export interface BodyRegion {
  id: string;
  label: string;
  /** Kapsadığı ham kas değerleri */
  muscles: string[];
}

export const BODY_REGIONS: BodyRegion[] = [
  { id: 'chest', label: 'Göğüs', muscles: ['chest'] },
  {
    id: 'back',
    label: 'Sırt',
    muscles: ['lats', 'middle back', 'lower back', 'traps'],
  },
  { id: 'shoulders', label: 'Omuz', muscles: ['shoulders', 'neck'] },
  { id: 'arms', label: 'Kol', muscles: ['biceps', 'triceps', 'forearms'] },
  { id: 'core', label: 'Karın', muscles: ['abdominals', 'core'] },
  {
    id: 'legs',
    label: 'Bacak',
    muscles: ['quadriceps', 'hamstrings', 'calves', 'adductors', 'abductors'],
  },
  { id: 'glutes', label: 'Kalça', muscles: ['glutes'] },
];

/**
 * Egzersiz listelerindeki tek filtre satırı: Tümü + bölgeler + bölgeye
 * oturmayan iki kategori. Kullanıcının sorusu "bugün neyi çalışacağım".
 */
export type ExerciseFilter =
  | { kind: 'all' }
  | { kind: 'region'; region: BodyRegion }
  | { kind: 'category'; category: string };

export interface ExerciseFilterOption {
  id: string;
  label: string;
  filter: ExerciseFilter;
}

export const EXERCISE_FILTER_OPTIONS: ExerciseFilterOption[] = [
  { id: 'all', label: 'Tümü', filter: { kind: 'all' } },
  ...BODY_REGIONS.map((region) => ({
    id: region.id,
    label: region.label,
    filter: { kind: 'region', region } as const,
  })),
  {
    id: 'cardio',
    label: CATEGORY_LABELS.cardio!,
    filter: { kind: 'category', category: 'cardio' },
  },
  {
    id: 'stretching',
    label: CATEGORY_LABELS.stretching!,
    filter: { kind: 'category', category: 'stretching' },
  },
];

function lookup(dict: Record<string, string>, raw: string): string {
  return dict[raw] ?? raw;
}

/** Bilinmeyen değerde ham değeri döndürür — ekranda boşluk kalmasın */
export function muscleLabel(raw: string): string {
  return lookup(MUSCLE_LABELS, raw);
}

/** `null` → boş metin; çağıran taraf zaten ekipmansız satırı gizliyor */
export function equipmentLabel(raw: string | null): string {
  return raw ? lookup(EQUIPMENT_LABELS, raw) : '';
}

export function categoryLabel(raw: string): string {
  return lookup(CATEGORY_LABELS, raw);
}

export function levelLabel(raw: string): string {
  return lookup(LEVEL_LABELS, raw);
}

export function forceLabel(raw: string): string {
  return lookup(FORCE_LABELS, raw);
}

export function mechanicLabel(raw: string): string {
  return lookup(MECHANIC_LABELS, raw);
}

/** Veritabanındaki JSON metni kas dizisine çevirir; bozuk veride `[]` */
export function parseMuscles(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((m): m is string => typeof m === 'string')
      : [];
  } catch {
    return [];
  }
}

export function muscleLabels(json: string | null): string[] {
  return parseMuscles(json).map(muscleLabel);
}
