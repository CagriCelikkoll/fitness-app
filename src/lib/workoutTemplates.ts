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
const TRICEPS_PUSHDOWN = 'Triceps_Pushdown';
const ROPE_PUSHDOWN = 'Triceps_Pushdown_-_Rope_Attachment';
const OVERHEAD_ROPE_EXTENSION = 'Triceps_Overhead_Extension_with_Rope';
const BARBELL_ROW = 'Bent_Over_Barbell_Row';
const DB_ROW = 'One-Arm_Dumbbell_Row';
const CG_PULLDOWN = 'Close-Grip_Front_Lat_Pulldown';
const DB_BENCH_PRESS = 'Dumbbell_Bench_Press';
const MACHINE_SHOULDER_PRESS = 'Machine_Shoulder_Military_Press';
const CABLE_CROSSOVER = 'Cable_Crossover';
const PEC_DECK = 'Butterfly';
const HACK_SQUAT = 'Hack_Squat';
const HIP_THRUST = 'Barbell_Hip_Thrust';
const BULGARIAN_SPLIT_SQUAT = 'Split_Squat_with_Dumbbells';
const LEG_EXTENSION = 'Leg_Extensions';
const SEATED_LEG_CURL = 'Seated_Leg_Curl';
const SEATED_CALF_RAISE = 'Seated_Calf_Raise';
const DEADLIFT = 'Barbell_Deadlift';
const CABLE_CRUNCH = 'Cable_Crunch';
const SKULLCRUSHER = 'EZ-Bar_Skullcrusher';

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
          ex(TRICEPS_PUSHDOWN, 2, '8-10'),
          ex(OVERHEAD_ROPE_EXTENSION, 2, '8-10'),
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
    // v3.8: arayüzde "Anterior / Posterior" yerine "Ön zincir / Arka
    // zincir"; id aynı. Yalnızca core hareketler, gün başına 7, büyük
    // birleşik hareketler önce.
    id: 'ant-post',
    name: 'Ön Zincir / Arka Zincir',
    shortName: 'Ön/Arka',
    description:
      'Vücudun ön ve arka zincirine göre ikiye ayrılmış program. Ön: göğüs, ön omuz, quadriceps, karın. Arka: sırt, arka omuz, hamstring, kalça. Haftada 2 gün.',
    dayCount: 2,
    days: [
      {
        name: 'Ön zincir',
        exercises: [
          ex(BENCH_PRESS, 3, '5-7'),
          ex(BULGARIAN_SPLIT_SQUAT, 3, '10-12'),
          ex(DB_SHOULDER_PRESS, 3, '8-10'),
          ex(PEC_DECK, 2, '8-10'),
          ex(LATERAL_RAISE, 3, '10-12'),
          ex(LEG_EXTENSION, 2, '10-12'),
          ex(SKULLCRUSHER, 3, '8-10'),
        ],
      },
      {
        name: 'Arka zincir',
        exercises: [
          ex(ROMANIAN_DEADLIFT, 3, '8-10'),
          ex(LAT_PULLDOWN, 3, '8-10'),
          ex(CLOSE_GRIP_PULLDOWN, 3, '10-12'),
          ex(SEATED_CABLE_ROW, 3, '10-12'),
          ex(LEG_CURL, 3, '10-12'),
          ex(FACE_PULL, 3, '10-12'),
          ex('Preacher_Curl', 3, '10-12'),
        ],
      },
    ],
  },
  {
    id: 'ant-post-4',
    name: 'Ön Zincir / Arka Zincir ×2',
    shortName: 'Ön/Arka',
    description:
      'Ön ve arka zincir haftada ikişer kez, kısa seanslarla. Ön: göğüs, ön omuz, quadriceps, karın. Arka: sırt, arka omuz, hamstring, kalça.',
    dayCount: 4,
    days: [
      {
        name: 'Ön A',
        exercises: [
          ex(SQUAT, 3, '6-8'),
          ex(BENCH_PRESS, 3, '6-8'),
          ex(DB_SHOULDER_PRESS, 2, '8-10'),
          ex(LEG_EXTENSION, 2, '10-12'),
          ex(CABLE_CRUNCH, 2, '12-15'),
        ],
      },
      {
        name: 'Arka A',
        exercises: [
          ex(ROMANIAN_DEADLIFT, 3, '8-10'),
          ex(LAT_PULLDOWN, 3, '8-10'),
          ex(SEATED_CABLE_ROW, 2, '10-12'),
          ex(LEG_CURL, 2, '10-12'),
          ex(FACE_PULL, 2, '12-15'),
        ],
      },
      {
        name: 'Ön B',
        exercises: [
          ex(LEG_PRESS, 3, '10-12'),
          ex(INCLINE_DB_PRESS, 3, '8-10'),
          ex(LATERAL_RAISE, 3, '12-15'),
          ex(TRICEPS_PUSHDOWN, 2, '10-12'),
          ex(HANGING_LEG_RAISE, 2, '10-15'),
        ],
      },
      {
        name: 'Arka B',
        exercises: [
          ex(HIP_THRUST, 3, '8-10'),
          ex(DB_ROW, 3, '8-10'),
          ex(CG_PULLDOWN, 2, '10-12'),
          ex(SEATED_LEG_CURL, 2, '10-12'),
          ex(HAMMER_CURL, 2, '10-12'),
        ],
      },
    ],
  },
  {
    id: 'fb-ab',
    name: 'Full Body A / B',
    shortName: 'FB',
    description:
      'Her antrenmanda bütün vücut; A ve B günleri sırayla. Haftada 2 gün A / B, 3 gün A / B / A (sonraki hafta B / A / B).',
    dayCount: 2,
    days: [
      {
        name: 'A',
        exercises: [
          ex(SQUAT, 4, '6-8'),
          ex(BENCH_PRESS, 4, '6-8'),
          ex(BARBELL_ROW, 3, '8-10'),
          ex(ROMANIAN_DEADLIFT, 3, '8-10'),
          ex(DB_SHOULDER_PRESS, 3, '8-10'),
          ex(LAT_PULLDOWN, 3, '10-12'),
          ex(LATERAL_RAISE, 3, '12-15'),
        ],
      },
      {
        name: 'B',
        exercises: [
          ex(LEG_PRESS, 4, '10-12'),
          ex(INCLINE_DB_PRESS, 4, '8-10'),
          ex(CG_PULLDOWN, 3, '8-10'),
          ex(HIP_THRUST, 3, '8-10'),
          ex(SEATED_CABLE_ROW, 3, '10-12'),
          ex(LATERAL_RAISE, 3, '12-15'),
          ex(LEG_CURL, 3, '10-12'),
        ],
      },
    ],
  },
  {
    id: 'upper-lower',
    name: 'Upper / Lower',
    shortName: 'U/L',
    description:
      'Üst ve alt vücut ayrı günlerde, ikişer kez: haftada 4 gün. Her kas grubu haftada 2 kez çalışır.',
    dayCount: 4,
    days: [
      {
        name: 'Üst A',
        exercises: [
          ex(BENCH_PRESS, 4, '6-8'),
          ex(BARBELL_ROW, 4, '8-10'),
          ex(DB_SHOULDER_PRESS, 3, '8-10'),
          ex(LAT_PULLDOWN, 3, '10-12'),
          ex(LATERAL_RAISE, 3, '12-15'),
          ex(BARBELL_CURL, 2, '10-12'),
          ex(TRICEPS_PUSHDOWN, 2, '10-12'),
        ],
      },
      {
        name: 'Alt A',
        exercises: [
          ex(SQUAT, 4, '6-8'),
          ex(ROMANIAN_DEADLIFT, 3, '8-10'),
          ex(LEG_PRESS, 3, '10-12'),
          ex(LEG_CURL, 3, '10-12'),
          ex(CALF_RAISE, 3, '10-12'),
          ex(CABLE_CRUNCH, 2, '12-15'),
        ],
      },
      {
        name: 'Üst B',
        exercises: [
          ex(INCLINE_DB_PRESS, 4, '8-10'),
          ex(CG_PULLDOWN, 3, '8-10'),
          ex(SEATED_CABLE_ROW, 3, '10-12'),
          ex(LATERAL_RAISE, 3, '12-15'),
          ex(PEC_DECK, 2, '12-15'),
          ex(FACE_PULL, 2, '12-15'),
          ex(HAMMER_CURL, 2, '10-12'),
        ],
      },
      {
        name: 'Alt B',
        exercises: [
          ex(HACK_SQUAT, 3, '8-10'),
          ex(HIP_THRUST, 3, '8-10'),
          ex(BULGARIAN_SPLIT_SQUAT, 3, '10-12'),
          ex(SEATED_LEG_CURL, 3, '10-12'),
          ex(LEG_EXTENSION, 2, '12-15'),
          ex(SEATED_CALF_RAISE, 3, '12-15'),
          ex(HANGING_LEG_RAISE, 2, '10-15'),
        ],
      },
    ],
  },
  {
    id: 'ul-ppl',
    name: 'Upper / Lower + Push / Pull / Legs',
    shortName: 'UL+PPL',
    description:
      'Haftanın ilk iki günü üst ve alt vücut, sonraki üç günü itme, çekme ve bacak. Her kas grubu haftada 2 kez.',
    dayCount: 5,
    days: [
      {
        name: 'Üst',
        exercises: [
          ex(BENCH_PRESS, 3, '6-8'),
          ex(BARBELL_ROW, 3, '8-10'),
          ex(DB_SHOULDER_PRESS, 3, '8-10'),
          ex(LAT_PULLDOWN, 3, '10-12'),
          ex(BARBELL_CURL, 2, '10-12'),
          ex(TRICEPS_PUSHDOWN, 2, '10-12'),
        ],
      },
      {
        name: 'Alt',
        exercises: [
          ex(SQUAT, 3, '6-8'),
          ex(ROMANIAN_DEADLIFT, 3, '8-10'),
          ex(LEG_PRESS, 3, '10-12'),
          ex(LEG_CURL, 3, '10-12'),
          ex(CALF_RAISE, 3, '10-12'),
        ],
      },
      {
        name: 'İtme',
        exercises: [
          ex(INCLINE_DB_PRESS, 4, '8-10'),
          ex(MACHINE_SHOULDER_PRESS, 3, '8-10'),
          ex(CABLE_CROSSOVER, 3, '12-15'),
          ex(LATERAL_RAISE, 3, '12-15'),
          ex(OVERHEAD_ROPE_EXTENSION, 2, '10-12'),
        ],
      },
      {
        name: 'Çekme',
        exercises: [
          ex(CG_PULLDOWN, 3, '8-10'),
          ex(SEATED_CABLE_ROW, 3, '10-12'),
          ex(DB_ROW, 3, '10-12'),
          ex(FACE_PULL, 3, '12-15'),
          ex(HAMMER_CURL, 2, '10-12'),
        ],
      },
      {
        name: 'Bacak',
        exercises: [
          ex(HACK_SQUAT, 3, '8-10'),
          ex(HIP_THRUST, 3, '8-10'),
          ex(BULGARIAN_SPLIT_SQUAT, 2, '10-12'),
          ex(SEATED_LEG_CURL, 3, '10-12'),
          ex(LEG_EXTENSION, 2, '12-15'),
          ex(SEATED_CALF_RAISE, 3, '12-15'),
        ],
      },
    ],
  },
  {
    id: 'ul-fb',
    name: 'Upper / Lower + Full Body',
    shortName: 'UL+FB',
    description:
      'Üst ve alt vücut ikişer kez, araya bir full body günü. Seanslar kısa (5 hareket), tempo sürdürülebilir.',
    dayCount: 5,
    days: [
      {
        name: 'Üst A',
        exercises: [
          ex(BENCH_PRESS, 3, '6-8'),
          ex(LAT_PULLDOWN, 3, '8-10'),
          ex(DB_SHOULDER_PRESS, 2, '8-10'),
          ex(BARBELL_CURL, 2, '10-12'),
          ex(TRICEPS_PUSHDOWN, 2, '10-12'),
        ],
      },
      {
        name: 'Alt A',
        exercises: [
          ex(SQUAT, 3, '6-8'),
          ex(LEG_CURL, 2, '10-12'),
          ex(LEG_EXTENSION, 2, '10-12'),
          ex(CALF_RAISE, 2, '10-12'),
          ex(CABLE_CRUNCH, 2, '12-15'),
        ],
      },
      {
        name: 'Full body',
        exercises: [
          ex(DEADLIFT, 2, '5-7'),
          ex(INCLINE_DB_PRESS, 2, '8-10'),
          ex(LEG_PRESS, 2, '10-12'),
          ex(SEATED_CABLE_ROW, 2, '10-12'),
          ex(LATERAL_RAISE, 2, '12-15'),
        ],
      },
      {
        name: 'Üst B',
        exercises: [
          ex(DB_BENCH_PRESS, 3, '8-10'),
          ex(DB_ROW, 3, '8-10'),
          ex(LATERAL_RAISE, 2, '12-15'),
          ex(FACE_PULL, 2, '12-15'),
          ex(HAMMER_CURL, 2, '10-12'),
        ],
      },
      {
        name: 'Alt B',
        exercises: [
          ex(ROMANIAN_DEADLIFT, 3, '8-10'),
          ex(BULGARIAN_SPLIT_SQUAT, 2, '10-12'),
          ex(HIP_THRUST, 2, '8-10'),
          ex(SEATED_LEG_CURL, 2, '10-12'),
          ex(HANGING_LEG_RAISE, 2, '10-15'),
        ],
      },
    ],
  },
  {
    // Klasik bölgesel split: hazır programlarda durur, öneride yalnızca 5
    // ve 6 günde "Alternatif" olarak çıkar (programRecommendation.ts).
    id: 'split5',
    name: '5 Günlük Bölgesel Split',
    shortName: 'Split5',
    description:
      'Göğüs, sırt, omuz, bacak ve kol ayrı günlerde. Her kas grubu haftada 1 kez; tecrübeli sporcular için.',
    dayCount: 5,
    days: [
      {
        name: 'Göğüs',
        exercises: [
          ex(BENCH_PRESS, 4, '6-8'),
          ex(INCLINE_DB_PRESS, 3, '8-10'),
          ex('Leverage_Chest_Press', 3, '10-12'),
          ex('Dips_-_Chest_Version', 3, '8-12'),
          ex(CABLE_CROSSOVER, 3, '12-15'),
        ],
      },
      {
        name: 'Sırt',
        exercises: [
          ex(DEADLIFT, 3, '5-7'),
          ex(LAT_PULLDOWN, 4, '8-10'),
          ex(BARBELL_ROW, 3, '8-10'),
          ex(SEATED_CABLE_ROW, 3, '10-12'),
          ex('Straight-Arm_Pulldown', 2, '12-15'),
        ],
      },
      {
        name: 'Omuz',
        exercises: [
          ex('Barbell_Shoulder_Press', 4, '6-8'),
          ex(LATERAL_RAISE, 4, '12-15'),
          ex('Reverse_Machine_Flyes', 3, '12-15'),
          ex('Front_Dumbbell_Raise', 2, '10-12'),
          ex('Barbell_Shrug', 3, '10-12'),
        ],
      },
      {
        name: 'Bacak',
        exercises: [
          ex(SQUAT, 4, '6-8'),
          ex(ROMANIAN_DEADLIFT, 3, '8-10'),
          ex(LEG_PRESS, 3, '10-12'),
          ex(LEG_CURL, 3, '10-12'),
          ex(LEG_EXTENSION, 3, '12-15'),
          ex(CALF_RAISE, 4, '10-12'),
        ],
      },
      {
        name: 'Kol',
        exercises: [
          ex('Close-Grip_Barbell_Bench_Press', 3, '8-10'),
          ex('EZ-Bar_Curl', 3, '8-10'),
          ex(ROPE_PUSHDOWN, 3, '10-12'),
          ex(HAMMER_CURL, 3, '10-12'),
          ex(OVERHEAD_ROPE_EXTENSION, 2, '10-12'),
          ex('Incline_Dumbbell_Curl', 2, '10-12'),
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
