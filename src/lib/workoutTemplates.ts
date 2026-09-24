/**
 * Hazır antrenman programları.
 *
 * Kullanıcı bir programı seçtiğinde her gün ayrı bir rutin olarak
 * kopyalanıyor (bkz. `applyTemplate.ts`); program tanımıyla oluşan
 * rutinler arasında kalıcı bağ yok.
 *
 * `exerciseId` değerleri `assets/seed/exercises.json`'daki gerçek id'ler.
 * Seed bu id'leri olduğu gibi `exercises.id`'ye yazıyor. Yanlış bir id
 * rutin eklerken FK hatasına düşer — `test/workoutTemplates.test.ts`
 * her id'nin JSON'da var olduğunu doğruluyor.
 */

export interface TemplateExercise {
  /** exercises.json'daki gerçek id */
  exerciseId: string;
  sets: number;
  /** "8-10" — aralık olduğu gibi */
  reps: string;
  restSeconds: number;
}

export interface TemplateDay {
  /** "İtme", "Göğüs ve Triceps" */
  name: string;
  exercises: TemplateExercise[];
}

export interface WorkoutTemplate {
  /** 'ppl', 'split4', 'ant-post' */
  id: string;
  /** "Push Pull Leg" */
  name: string;
  /** "PPL" — rutin adı öneki */
  shortName: string;
  description: string;
  dayCount: number;
  days: TemplateDay[];
}

/**
 * Tekrar aralığının alt sınırına göre dinlenme süresi:
 * 5-8 → 180 sn, 8-10 → 120 sn, 10 ve üzeri → 90 sn.
 */
export function restForReps(reps: string): number {
  const low = parseInt(reps, 10);
  if (low < 8) return 180;
  if (low < 10) return 120;
  return 90;
}

function ex(exerciseId: string, sets: number, reps: string): TemplateExercise {
  return { exerciseId, sets, reps, restSeconds: restForReps(reps) };
}

// Birden fazla programda geçen hareketler — tek yerden eşleşsin
const BENCH_PRESS = 'Barbell_Bench_Press_-_Medium_Grip';
const DB_SHOULDER_PRESS = 'Dumbbell_Shoulder_Press';
const INCLINE_DB_PRESS = 'Incline_Dumbbell_Press';
const LATERAL_RAISE = 'Side_Lateral_Raise';
const LAT_PULLDOWN = 'Wide-Grip_Lat_Pulldown';
const CLOSE_GRIP_PULLDOWN = 'V-Bar_Pulldown';
const SEATED_CABLE_ROW = 'Seated_Cable_Rows';
const FACE_PULL = 'Face_Pull';
const BARBELL_CURL = 'Barbell_Curl';
const HAMMER_CURL = 'Hammer_Curls';
const SQUAT = 'Barbell_Squat';
const ROMANIAN_DEADLIFT = 'Romanian_Deadlift';
const LEG_PRESS = 'Leg_Press';
const LEG_CURL = 'Lying_Leg_Curls';
const CALF_RAISE = 'Standing_Calf_Raises';
const HANGING_LEG_RAISE = 'Hanging_Leg_Raise';

export const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'ppl',
    name: 'Push Pull Leg',
    shortName: 'PPL',
    description:
      'İtme, çekme ve bacak olarak üçe ayrılmış klasik program. Haftada 3 veya 6 gün uygulanabilir.',
    dayCount: 3,
    days: [
      {
        name: 'İtme',
        exercises: [
          ex(BENCH_PRESS, 3, '5-7'),
          ex(DB_SHOULDER_PRESS, 3, '6-8'),
          ex(INCLINE_DB_PRESS, 3, '8-10'),
          ex(LATERAL_RAISE, 2, '10-12'),
          ex('Triceps_Pushdown', 2, '8-10'),
          ex('Cable_Rope_Overhead_Triceps_Extension', 2, '8-10'),
        ],
      },
      {
        name: 'Çekme',
        exercises: [
          ex(LAT_PULLDOWN, 3, '5-7'),
          ex(CLOSE_GRIP_PULLDOWN, 3, '6-8'),
          ex(SEATED_CABLE_ROW, 3, '8-10'),
          ex(FACE_PULL, 2, '10-12'),
          ex(BARBELL_CURL, 2, '8-10'),
          ex(HAMMER_CURL, 2, '8-10'),
        ],
      },
      {
        name: 'Bacak ve Karın',
        exercises: [
          ex(SQUAT, 3, '6-8'),
          ex(ROMANIAN_DEADLIFT, 2, '8-10'),
          ex(LEG_PRESS, 2, '10-12'),
          ex(LEG_CURL, 2, '10-12'),
          ex(CALF_RAISE, 4, '8-10'),
          ex(HANGING_LEG_RAISE, 2, '10-15'),
        ],
      },
    ],
  },
  {
    id: 'split4',
    name: '4 Günlük Split',
    shortName: 'Split',
    description:
      'Kas gruplarının ayrı günlere bölündüğü klasik split. 2. ve 4. gün arasında dinlenme veya kardiyo günü bırakılır.',
    dayCount: 4,
    days: [
      {
        name: 'Göğüs ve Triceps',
        exercises: [
          ex(BENCH_PRESS, 4, '8-10'),
          ex(INCLINE_DB_PRESS, 3, '10-12'),
          ex('Cable_Crossover', 3, '12-15'),
          ex('Close-Grip_Barbell_Bench_Press', 3, '8-10'),
          ex('Triceps_Pushdown_-_Rope_Attachment', 3, '12'),
        ],
      },
      {
        name: 'Sırt ve Biceps',
        exercises: [
          ex(LAT_PULLDOWN, 4, '10'),
          ex('Bent_Over_Barbell_Row', 4, '8-10'),
          ex(SEATED_CABLE_ROW, 3, '12'),
          ex(BARBELL_CURL, 3, '8-10'),
          ex(HAMMER_CURL, 3, '12'),
        ],
      },
      {
        name: 'Omuz ve Karın',
        exercises: [
          ex(DB_SHOULDER_PRESS, 4, '8-10'),
          ex(LATERAL_RAISE, 4, '12-15'),
          ex(FACE_PULL, 3, '15'),
          ex(HANGING_LEG_RAISE, 3, '10-15'),
          ex('Cable_Crunch', 3, '15-20'),
        ],
      },
      {
        name: 'Bacak',
        exercises: [
          ex(SQUAT, 4, '8-10'),
          ex(ROMANIAN_DEADLIFT, 4, '10'),
          ex(LEG_PRESS, 3, '12'),
          ex(LEG_CURL, 3, '15'),
          ex(CALF_RAISE, 4, '15'),
        ],
      },
    ],
  },
  {
    id: 'ant-post',
    name: 'Anterior / Posterior',
    shortName: 'A/P',
    description:
      'Vücudun ön ve arka zincirine göre ikiye ayrılmış program. Her iki günde de bacak çalışması var, haftada 2-4 gün uygulanabilir.',
    dayCount: 2,
    days: [
      {
        name: 'Anterior',
        exercises: [
          ex(BENCH_PRESS, 3, '5-7'),
          ex(DB_SHOULDER_PRESS, 3, '8-10'),
          ex('Butterfly', 2, '8-10'),
          ex(LATERAL_RAISE, 3, '10-12'),
          ex('EZ-Bar_Skullcrusher', 3, '8-10'),
          ex('Split_Squat_with_Dumbbells', 3, '10-12'),
          ex('Leg_Extensions', 2, '10-12'),
        ],
      },
      {
        name: 'Posterior',
        exercises: [
          ex(LAT_PULLDOWN, 3, '8-10'),
          ex(CLOSE_GRIP_PULLDOWN, 3, '10-12'),
          ex(SEATED_CABLE_ROW, 3, '10-12'),
          ex(FACE_PULL, 3, '10-12'),
          ex('Preacher_Curl', 3, '10-12'),
          ex(HAMMER_CURL, 2, '8-10'),
          ex(ROMANIAN_DEADLIFT, 3, '10-12'),
          ex('Hyperextensions_Back_Extensions', 2, '10-12'),
        ],
      },
    ],
  },
];

export function getTemplate(id: string): WorkoutTemplate | undefined {
  return WORKOUT_TEMPLATES.find((t) => t.id === id);
}

/** Programdaki toplam hareket sayısı (günler toplamı) */
export function templateExerciseCount(template: WorkoutTemplate): number {
  return template.days.reduce((n, d) => n + d.exercises.length, 0);
}

/** Rutin adı: "PPL — İtme" */
export function templateRoutineName(
  template: WorkoutTemplate,
  day: TemplateDay
): string {
  return `${template.shortName} — ${day.name}`;
}
