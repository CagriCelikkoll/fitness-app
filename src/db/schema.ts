/**
 * Fitness App - Aşama 1 Veri Modeli
 *
 * Markdown şemasının (fitness-app-asama1-veri-modeli.md) TypeScript karşılığı.
 * Drizzle ORM, sqlite-core dialect kullanır.
 *
 * Tasarım kararları:
 * - UUID primary key (TEXT) — gelecekteki sync için
 * - Plan (routines) ile gerçekleşen (sessions) ayrı tablolar — snapshot mantığı
 * - Strength + cardio aynı çatı altında: workout_sessions altında
 *   session_exercises (strength) ve cardio_segments (cardio) kardeş yaşar
 * - Wearable entegrasyonu için bugünden hazır alanlar (external_source vb.)
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// ============================================================================
// 1. exercises — egzersiz kütüphanesi
// ============================================================================
export const exercises = sqliteTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    nameTr: text('name_tr'),
    primaryMuscles: text('primary_muscles').notNull(), // JSON: '["chest"]'
    secondaryMuscles: text('secondary_muscles'), // JSON: '["triceps","shoulders"]'
    equipment: text('equipment'),
    mechanic: text('mechanic'), // 'compound' | 'isolation'
    force: text('force'), // 'push' | 'pull' | 'static'
    category: text('category').notNull(), // 'strength' | 'cardio' | 'stretching'
    level: text('level'), // 'beginner' | 'intermediate' | 'expert'
    instructions: text('instructions'), // JSON array
    imagePaths: text('image_paths'), // JSON array
    isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
    isArchived: integer('is_archived', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => ({
    categoryIdx: index('idx_exercises_category').on(t.category),
    archivedIdx: index('idx_exercises_archived').on(t.isArchived),
  })
);

// ============================================================================
// 2. routines — antrenman şablonları
// ============================================================================
export const routines = sqliteTable('routines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  estimatedDurationMin: integer('estimated_duration_min'),
  isArchived: integer('is_archived', { mode: 'boolean' })
    .notNull()
    .default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ============================================================================
// 3. routine_exercises — şablondaki egzersizler ve plan (strength + cardio)
// ============================================================================
export const routineExercises = sqliteTable(
  'routine_exercises',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    orderIndex: integer('order_index').notNull(),

    // Strength alanları
    targetSets: integer('target_sets'),
    targetReps: text('target_reps'), // "8-12" veya "10"
    targetWeightKg: real('target_weight_kg'),
    targetRir: integer('target_rir'),

    // Cardio alanları
    targetDurationSeconds: integer('target_duration_seconds'),
    targetDistanceKm: real('target_distance_km'),
    targetPaceSecondsPerKm: integer('target_pace_seconds_per_km'),

    restSeconds: integer('rest_seconds').notNull().default(90),
    notes: text('notes'),
    supersetGroup: integer('superset_group'),
  },
  (t) => ({
    routineIdx: index('idx_routine_exercises_routine').on(t.routineId),
  })
);

// ============================================================================
// 4. workout_sessions — gerçekleşen antrenman
// ============================================================================
export const workoutSessions = sqliteTable(
  'workout_sessions',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id').references(() => routines.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    durationSeconds: integer('duration_seconds'),
    notes: text('notes'),
    bodyweightKg: real('bodyweight_kg'),
    perceivedDifficulty: integer('perceived_difficulty'), // 1-10
    createdAt: text('created_at')
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => ({
    startedAtIdx: index('idx_sessions_started_at').on(t.startedAt),
    routineIdx: index('idx_sessions_routine').on(t.routineId),
  })
);

// ============================================================================
// 5. session_exercises — bu seansta yapılan strength egzersizleri
// ============================================================================
export const sessionExercises = sqliteTable(
  'session_exercises',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    orderIndex: integer('order_index').notNull(),
    supersetGroup: integer('superset_group'),
    notes: text('notes'),
  },
  (t) => ({
    sessionIdx: index('idx_session_exercises_session').on(t.sessionId),
    exerciseIdx: index('idx_session_exercises_exercise').on(t.exerciseId),
  })
);

// ============================================================================
// 6. sets — her bir setin gerçek kaydı (strength logbook)
// ============================================================================
export const sets = sqliteTable(
  'sets',
  {
    id: text('id').primaryKey(),
    sessionExerciseId: text('session_exercise_id')
      .notNull()
      .references(() => sessionExercises.id, { onDelete: 'cascade' }),
    setNumber: integer('set_number').notNull(),
    setType: text('set_type').notNull().default('normal'),
    // 'warmup' | 'normal' | 'drop' | 'failure' | 'amrap'
    reps: integer('reps'),
    weightKg: real('weight_kg'),
    rir: integer('rir'), // reps in reserve
    rpe: real('rpe'), // 6.0 - 10.0
    isCompleted: integer('is_completed', { mode: 'boolean' })
      .notNull()
      .default(false),
    restTakenSeconds: integer('rest_taken_seconds'),
    notes: text('notes'),
    completedAt: text('completed_at'),
  },
  (t) => ({
    sessionExerciseIdx: index('idx_sets_session_exercise').on(
      t.sessionExerciseId
    ),
    completedAtIdx: index('idx_sets_completed_at').on(t.completedAt),
  })
);

// ============================================================================
// 7. cardio_segments — kardiyo seansları (workout_sessions altında)
// ============================================================================
export const cardioSegments = sqliteTable(
  'cardio_segments',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    orderIndex: integer('order_index').notNull(),

    // Temel metrikler
    durationSeconds: integer('duration_seconds').notNull(),
    distanceKm: real('distance_km'),

    // Detay metrikler (manuel veya wearable'dan)
    avgHeartRate: integer('avg_heart_rate'),
    maxHeartRate: integer('max_heart_rate'),
    caloriesKcal: integer('calories_kcal'),
    avgPaceSecondsPerKm: integer('avg_pace_seconds_per_km'),
    elevationGainM: real('elevation_gain_m'),

    // Tip ve algılanan zorluk
    cardioType: text('cardio_type').notNull().default('steady'),
    // 'steady' | 'hiit' | 'intervals' | 'tempo'
    perceivedEffort: integer('perceived_effort'), // 1-10

    // Wearable/external entegrasyon (Aşama 4'te dolacak)
    externalSource: text('external_source'),
    // 'manual' | 'health_connect' | 'apple_health' | 'garmin'
    externalId: text('external_id'),
    routePolyline: text('route_polyline'),

    notes: text('notes'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => ({
    sessionIdx: index('idx_cardio_segments_session').on(t.sessionId),
    exerciseIdx: index('idx_cardio_segments_exercise').on(t.exerciseId),
  })
);

// ============================================================================
// 8. body_metrics — vücut takibi
// ============================================================================
export const bodyMetrics = sqliteTable(
  'body_metrics',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(), // YYYY-MM-DD
    weightKg: real('weight_kg'),
    bodyFatPct: real('body_fat_pct'),
    waistCm: real('waist_cm'),
    chestCm: real('chest_cm'),
    armCm: real('arm_cm'),
    thighCm: real('thigh_cm'),
    hipCm: real('hip_cm'),
    neckCm: real('neck_cm'),
    notes: text('notes'),
    photoPath: text('photo_path'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => ({
    dateUnique: uniqueIndex('idx_body_metrics_date').on(t.date),
  })
);

// ============================================================================
// 9. app_settings — kullanıcı ayarları (tek satırlık tablo)
// ============================================================================
export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(), // her zaman 1
  weightUnit: text('weight_unit').notNull().default('kg'),
  distanceUnit: text('distance_unit').notNull().default('km'),
  defaultRestSeconds: integer('default_rest_seconds').notNull().default(90),
  heightCm: real('height_cm'),
  birthDate: text('birth_date'),
  gender: text('gender'),
  goal: text('goal'), // 'cut' | 'bulk' | 'maintain' | 'recomp'
  theme: text('theme').notNull().default('system'),
  // 'light' | 'dark' | 'system'
  restTimerSound: integer('rest_timer_sound', { mode: 'boolean' })
    .notNull()
    .default(true),
  restTimerVibrate: integer('rest_timer_vibrate', { mode: 'boolean' })
    .notNull()
    .default(true),
  language: text('language').notNull().default('tr'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(current_timestamp)`),
});

// ============================================================================
// İlişkiler (Drizzle relational queries için)
// ============================================================================

export const exercisesRelations = relations(exercises, ({ many }) => ({
  routineExercises: many(routineExercises),
  sessionExercises: many(sessionExercises),
  cardioSegments: many(cardioSegments),
}));

export const routinesRelations = relations(routines, ({ many }) => ({
  exercises: many(routineExercises),
  sessions: many(workoutSessions),
}));

export const routineExercisesRelations = relations(
  routineExercises,
  ({ one }) => ({
    routine: one(routines, {
      fields: [routineExercises.routineId],
      references: [routines.id],
    }),
    exercise: one(exercises, {
      fields: [routineExercises.exerciseId],
      references: [exercises.id],
    }),
  })
);

export const workoutSessionsRelations = relations(
  workoutSessions,
  ({ one, many }) => ({
    routine: one(routines, {
      fields: [workoutSessions.routineId],
      references: [routines.id],
    }),
    sessionExercises: many(sessionExercises),
    cardioSegments: many(cardioSegments),
  })
);

export const sessionExercisesRelations = relations(
  sessionExercises,
  ({ one, many }) => ({
    session: one(workoutSessions, {
      fields: [sessionExercises.sessionId],
      references: [workoutSessions.id],
    }),
    exercise: one(exercises, {
      fields: [sessionExercises.exerciseId],
      references: [exercises.id],
    }),
    sets: many(sets),
  })
);

export const setsRelations = relations(sets, ({ one }) => ({
  sessionExercise: one(sessionExercises, {
    fields: [sets.sessionExerciseId],
    references: [sessionExercises.id],
  }),
}));

export const cardioSegmentsRelations = relations(cardioSegments, ({ one }) => ({
  session: one(workoutSessions, {
    fields: [cardioSegments.sessionId],
    references: [workoutSessions.id],
  }),
  exercise: one(exercises, {
    fields: [cardioSegments.exerciseId],
    references: [exercises.id],
  }),
}));

// ============================================================================
// Inferred types — bütün şemadan TypeScript tipi otomatik üretiyoruz
// ============================================================================
export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;

export type Routine = typeof routines.$inferSelect;
export type NewRoutine = typeof routines.$inferInsert;

export type RoutineExercise = typeof routineExercises.$inferSelect;
export type NewRoutineExercise = typeof routineExercises.$inferInsert;

export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type NewWorkoutSession = typeof workoutSessions.$inferInsert;

export type SessionExercise = typeof sessionExercises.$inferSelect;
export type NewSessionExercise = typeof sessionExercises.$inferInsert;

export type WorkoutSet = typeof sets.$inferSelect;
export type NewWorkoutSet = typeof sets.$inferInsert;

export type CardioSegment = typeof cardioSegments.$inferSelect;
export type NewCardioSegment = typeof cardioSegments.$inferInsert;

export type BodyMetric = typeof bodyMetrics.$inferSelect;
export type NewBodyMetric = typeof bodyMetrics.$inferInsert;

export type AppSettings = typeof appSettings.$inferSelect;
