/**
 * Sentetik "bir yıllık kullanıcı" yedeği (backup.ts formatı, formatVersion 1).
 *
 * Gerçek yedek dosyası yokken migration testleri bununla çalışıyor.
 * Deterministik (sabit tohumlu üreteç): her çalıştırmada aynı dosya.
 * Bütün sütunlar açıkça dolu ya da null — `buildBackup` çıktısıyla
 * birebir karşılaştırılabilsin.
 *
 * Hacim: 200 antrenman × 6 hareket × 4 set ≈ 6.500 satır; tasarımdaki
 * (docs/sync-tasarim.md, madde 7) yoğun kullanıcı tahmini.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BackupFile } from '@/lib/backup';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const uuid = (prefix: number, n: number) =>
  `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export function buildSyntheticYearBackup(options: { sessions?: number } = {}): BackupFile {
  const sessionCount = options.sessions ?? 200;
  const rand = rng(20251001);
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
  const day = (offset: number, hour = 18) =>
    new Date(Date.UTC(2025, 9, 1 + offset, hour, 0, 0)).toISOString();

  const seedIds = JSON.parse(
    readFileSync(path.join(ROOT, 'test/fixtures/seed-exercise-ids.json'), 'utf8')
  ) as string[];
  const strengthIds = seedIds.filter((id) => !id.startsWith('cardio_')).slice(0, 40);
  const cardioId = 'cardio_running_outdoor';

  const exercises = [...strengthIds, cardioId].map((id) => ({
    id,
    name: id.replace(/_/g, ' '),
    nameTr: null,
    primaryMuscles: JSON.stringify(['chest']),
    secondaryMuscles: JSON.stringify([]),
    equipment: 'barbell',
    mechanic: id === cardioId ? null : 'compound',
    force: id === cardioId ? null : 'push',
    category: id === cardioId ? 'cardio' : 'strength',
    level: 'beginner',
    instructions: JSON.stringify(['Adım 1']),
    imagePaths: JSON.stringify([]),
    isCustom: false,
    isArchived: false,
    createdAt: '2025-09-30 10:00:00',
    updatedAt: '2025-09-30 10:00:00',
  }));

  const appSettings = [
    {
      id: 1,
      weightUnit: 'kg',
      distanceUnit: 'km',
      defaultRestSeconds: 120,
      heightCm: 180,
      birthDate: '1998-04-12',
      gender: 'male',
      goal: 'bulk',
      theme: 'dark',
      restTimerSound: true,
      restTimerVibrate: false,
      language: 'tr',
      createdAt: '2025-09-30 10:00:00',
      updatedAt: '2025-10-02T08:00:00.000Z',
    },
  ];

  let n = 0;
  const routines = Array.from({ length: 5 }, (_, i) => ({
    id: uuid(1, ++n),
    name: `Rutin ${i + 1}`,
    description: i % 2 === 0 ? 'Açıklama' : null,
    color: null,
    estimatedDurationMin: null,
    isArchived: false,
    createdAt: '2025-10-01 09:00:00',
    updatedAt: day(i),
  }));

  const routineExercises = routines.flatMap((r, ri) =>
    Array.from({ length: 6 }, (_, i) => ({
      id: uuid(2, ++n),
      routineId: r.id,
      exerciseId: strengthIds[(ri * 6 + i) % strengthIds.length],
      orderIndex: i,
      targetSets: 4,
      targetReps: '8-12',
      targetWeightKg: i === 0 ? 60 : null,
      targetRir: null,
      targetDurationSeconds: null,
      targetDistanceKm: null,
      targetPaceSecondsPerKm: null,
      restSeconds: 90,
      notes: null,
      supersetGroup: i >= 4 ? 1 : null,
    }))
  );

  const bodyMetrics = Array.from({ length: 52 }, (_, w) => ({
    id: uuid(3, ++n),
    date: day(w * 7).slice(0, 10),
    weightKg: Math.round((78 + rand() * 4) * 10) / 10,
    bodyFatPct: w % 4 === 0 ? 15.5 : null,
    waistCm: w % 4 === 0 ? 82 : null,
    chestCm: null,
    armCm: null,
    thighCm: null,
    hipCm: null,
    neckCm: null,
    notes: null,
    photoPath: null,
    createdAt: '2025-10-01 09:00:00',
  }));

  const workoutSessions: Record<string, unknown>[] = [];
  const sessionExercises: Record<string, unknown>[] = [];
  const sets: Record<string, unknown>[] = [];
  const cardioSegments: Record<string, unknown>[] = [];

  for (let s = 0; s < sessionCount; s++) {
    const routine = routines[s % routines.length];
    const startedAt = day(Math.floor(s * 1.8), 17);
    const durationSeconds = 3600 + Math.floor(rand() * 1800);
    const sessionId = uuid(4, ++n);
    workoutSessions.push({
      id: sessionId,
      // Bazı antrenmanların rutini silinmiş (set null)
      routineId: s % 17 === 0 ? null : routine.id,
      name: routine.name,
      startedAt,
      endedAt: new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString(),
      durationSeconds,
      notes: s % 9 === 0 ? 'Bugün yorgundum, ağırlıkları düşürdüm.' : null,
      bodyweightKg: null,
      perceivedDifficulty: null,
      createdAt: startedAt.replace('T', ' ').slice(0, 19),
    });

    for (let e = 0; e < 6; e++) {
      const seId = uuid(5, ++n);
      sessionExercises.push({
        id: seId,
        sessionId,
        exerciseId: pick(strengthIds),
        orderIndex: e,
        supersetGroup: e >= 4 ? 1 : null,
        notes: e === 0 && s % 5 === 0 ? 'Dirsek ağrısı yok' : null,
      });
      for (let k = 0; k < 4; k++) {
        const warmup = k === 0 && e === 0;
        sets.push({
          id: uuid(6, ++n),
          sessionExerciseId: seId,
          setNumber: k + 1,
          setType: warmup ? 'warmup' : 'normal',
          reps: 6 + Math.floor(rand() * 7),
          weightKg: Math.round((40 + rand() * 60) * 2) / 2,
          rir: warmup ? null : Math.floor(rand() * 4),
          rpe: null,
          isCompleted: true,
          restTakenSeconds: null,
          notes: null,
          completedAt: startedAt,
        });
      }
    }

    if (s % 10 === 0) {
      cardioSegments.push({
        id: uuid(7, ++n),
        sessionId,
        exerciseId: cardioId,
        orderIndex: 6,
        durationSeconds: 900,
        distanceKm: 2.5,
        avgHeartRate: null,
        maxHeartRate: null,
        caloriesKcal: null,
        avgPaceSecondsPerKm: 360,
        elevationGainM: null,
        cardioType: 'steady',
        perceivedEffort: null,
        externalSource: 'manual',
        externalId: null,
        routePolyline: null,
        notes: null,
        startedAt,
        completedAt: startedAt,
        createdAt: startedAt.replace('T', ' ').slice(0, 19),
      });
    }
  }

  return {
    formatVersion: 1,
    appVersion: '0.10.0',
    exportedAt: '2026-10-01T12:00:00.000Z',
    tables: {
      appSettings,
      exercises,
      routines,
      bodyMetrics,
      routineExercises,
      workoutSessions,
      sessionExercises,
      cardioSegments,
      sets,
    },
  };
}
