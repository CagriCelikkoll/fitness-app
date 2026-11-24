/**
 * 0.13 Bölüm 3: paylaşım kartı. Kart verisi (rekor, rekorsuz antrenman,
 * kardiyo), metin uzunluğuna göre yazı boyutu, Instagram güvenli alanları,
 * kullanıcı bilgisinin karta girmemesi, paylaşım akışı.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { cardioSegments, sets } from '@/db/schema';
import { finishSessionRecord } from '@/lib/finishSession';
import type { RecordPageData } from '@/lib/recordEvents';
import {
  EXERCISE_NAME_SIZES,
  HEADLINE_SIZES,
  MAX_RECORD_LINES,
  SAFE_BOTTOM,
  SAFE_TOP,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  SHARE_FOOTER,
  TEXT_WIDTH,
  TITLE_SIZES,
  fitFontSize,
  recordShareCard,
  shareCardLabel,
  workoutShareCard,
  type WorkoutShareInput,
} from '@/lib/shareCard';
import { loadWorkoutShareCard } from '@/lib/shareData';
import { createSession, createTestDb, seedExercise, type TestDb } from './helpers/testDb';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

const weightPage: RecordPageData = {
  exerciseName: 'Göğüs Presi',
  weightKg: 85,
  reps: 3,
  e1rm: 93.5,
  kinds: ['weight'],
  previousE1rm: null,
  previousWeight: { weightKg: 80, reps: 10 },
  moreCount: 0,
};

const bothPage: RecordPageData = {
  exerciseName: 'Squat',
  weightKg: 102.5,
  reps: 5,
  e1rm: 102.5 * (1 + 5 / 30),
  kinds: ['weight', 'e1rm'],
  previousE1rm: { weightKg: 100, reps: 5, e1rm: 100 * (1 + 5 / 30) },
  previousWeight: { weightKg: 100, reps: 5 },
  moreCount: 2,
};

const baseWorkout: WorkoutShareInput = {
  name: 'Üst Vücut A',
  durationSeconds: 3900,
  volumeKg: 12450,
  completedSets: 18,
  records: [],
  cardioSeconds: 0,
  cardioDistanceKm: 0,
  exercises: [{ primaryMuscles: '["chest"]', category: 'strength', sets: 18 }],
};

describe('rekor kartı', () => {
  it('kilo rekoru: rozet türü, dev yazı, kilo farkı', () => {
    const card = recordShareCard(weightPage);
    expect(card).toMatchObject({
      kind: 'record',
      cover: 'rekor',
      kindsText: 'EN AĞIR KİLO',
      exerciseName: 'Göğüs Presi',
      headline: ['85 kg ', '× 3'],
      gainLine: 'Önceki en iyiye göre +5 kg',
      moreText: null,
    });
  });

  it('ikisi birden: 1RM farkı, "+2 rekor daha"', () => {
    const card = recordShareCard(bothPage);
    expect(card.kindsText).toBe('EN AĞIR KİLO · TAHMİNİ 1RM');
    expect(card.gainLine).toBe('Önceki en iyiye göre Tahmini 1RM +2,9 kg');
    expect(card.moreText).toBe('+2 rekor daha');
  });
});

describe('antrenman kartı', () => {
  it('rekorsuz: süre, hacim, set; rekor bölümü yok', () => {
    const card = workoutShareCard(baseWorkout);
    expect(card.stats).toEqual([
      { label: 'Süre', value: '1 sa 5' },
      { label: 'Hacim', value: '12.450 kg' },
      { label: 'Set', value: '18' },
    ]);
    expect(card.records).toEqual([]);
    expect(card.moreRecords).toBeNull();
    expect(card.context).toBe('upper');
  });

  it('rekorlu: en fazla 3 satır, kalanı "+N rekor daha"', () => {
    const records = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ exerciseName: n, weightKg: 50 + i * 2.5, reps: 5 }));
    const card = workoutShareCard({ ...baseWorkout, records });
    expect(card.records).toHaveLength(MAX_RECORD_LINES);
    expect(card.records[1]).toBe('B · 52,5 kg × 5');
    expect(card.moreRecords).toBe('+2 rekor daha');
  });

  it('yalnız kardiyo: süre ve mesafe; hacim / set yok', () => {
    const card = workoutShareCard({
      ...baseWorkout,
      name: 'Kürek',
      volumeKg: 0,
      completedSets: 0,
      durationSeconds: 1800,
      cardioSeconds: 1800,
      cardioDistanceKm: 6.25,
      exercises: [{ primaryMuscles: '[]', category: 'cardio', sets: 0 }],
    });
    expect(card.stats).toEqual([
      { label: 'Süre', value: '30 dk' },
      { label: 'Mesafe', value: '6,25 km' },
    ]);
  });

  it('kardiyo, süre kaydı yoksa kardiyo süresi gösterilir', () => {
    const card = workoutShareCard({
      ...baseWorkout,
      volumeKg: 0,
      completedSets: 0,
      durationSeconds: null,
      cardioSeconds: 1200,
      cardioDistanceKm: 0,
    });
    expect(card.stats).toEqual([{ label: 'Kardiyo', value: '20 dk' }]);
  });

  it('karttaki her yazı kullanıcı kimliği / adı / e-posta taşımıyor', () => {
    const card = workoutShareCard(baseWorkout);
    const keys = JSON.stringify([card, recordShareCard(bothPage)]);
    for (const k of ['userId', 'email', 'displayName', 'user']) expect(keys).not.toContain(`"${k}"`);
  });
});

describe('yazı boyutu metin uzunluğuna göre', () => {
  it('kısa yazı en büyük, uzun yazı küçülür', () => {
    expect(fitFontSize('5 kg × 8', HEADLINE_SIZES)).toBe(HEADLINE_SIZES[0]);
    expect(fitFontSize('80 kg × 5', HEADLINE_SIZES) * 0.6 * 9).toBeLessThanOrEqual(TEXT_WIDTH);
    const long = fitFontSize('202,75 kg × 12', HEADLINE_SIZES);
    expect(long).toBeLessThan(HEADLINE_SIZES[0]);
    expect(long * 0.6 * '202,75 kg × 12'.length).toBeLessThanOrEqual(TEXT_WIDTH);
  });

  it('uzun hareket adı iki satıra sığacak boyda; en küçüğün altına inmez', () => {
    const name = 'Dumbbell Incline Bench Press (Tek Kol)';
    const size = fitFontSize(name, EXERCISE_NAME_SIZES, TEXT_WIDTH, 2);
    expect(size).toBeLessThanOrEqual(EXERCISE_NAME_SIZES[0]);
    expect(fitFontSize('x'.repeat(500), TITLE_SIZES, TEXT_WIDTH, 2)).toBe(TITLE_SIZES[TITLE_SIZES.length - 1]);
  });

  it('rutin adı uzadıkça küçülür', () => {
    const short = workoutShareCard({ ...baseWorkout, name: 'Bacak' }).titleSize;
    const long = workoutShareCard({ ...baseWorkout, name: 'Ön Zincir ve Kalça Odaklı Güç Günü' }).titleSize;
    expect(long).toBeLessThan(short);
  });
});

describe('ölçüler ve güvenli alanlar', () => {
  it('9:16, 1080 × 1920; üstte 250, altta 350 px yazısız', () => {
    expect(SHARE_CARD_WIDTH / SHARE_CARD_HEIGHT).toBeCloseTo(9 / 16);
    expect(SAFE_TOP).toBeGreaterThanOrEqual(250);
    expect(SAFE_BOTTOM).toBeGreaterThanOrEqual(350);
  });

  it('kart bileşeni yazıları güvenli alanların içinde tutuyor', () => {
    const src = read('src/components/ShareCard.tsx');
    expect(src).toContain('top: SAFE_TOP * s');
    expect(src).toContain('bottom: SAFE_BOTTOM * s');
    expect(src).toContain('(SAFE_BOTTOM + FOOTER_HEIGHT + 64) * s');
    expect(SHARE_FOOTER).toBe("Dinç · Google Play'de ücretsiz");
  });

  it('erişilebilirlik metni', () => {
    expect(shareCardLabel(recordShareCard(weightPage))).toBe('Rekor kartı: Göğüs Presi, 85 kg × 3');
    expect(shareCardLabel(workoutShareCard(baseWorkout))).toContain('Antrenman kartı: Üst Vücut A, Süre 1 sa 5');
  });
});

describe('paylaşım akışı', () => {
  it('view-shot → expo-sharing; geçici dosya her durumda siliniyor', () => {
    const src = read('src/lib/shareNative.ts');
    expect(src).toContain("result: 'tmpfile'");
    expect(src).toContain('width: SHARE_CARD_WIDTH');
    expect(src).toMatch(/finally \{\s*removeTemp\(uri\);/);
    expect(src).toContain('releaseCapture(uri)');
  });

  it('Meta SDK / Facebook kimliği yok, sunucuya istek yok', () => {
    const pkg = read('package.json');
    expect(pkg).not.toMatch(/react-native-fbsdk|facebook|react-native-share"/);
    expect(read('app.json')).not.toMatch(/facebookAppId|FacebookAppID/);
    for (const f of ['src/lib/shareNative.ts', 'src/lib/shareCard.ts', 'src/lib/shareData.ts', 'src/components/ShareCard.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/fetch\(|getSupabase|supabase/);
    }
  });

  it('üç giriş noktası: rekor sayfası, özet, ayrıntı ⋯', () => {
    expect(read('src/components/RecordCelebration.tsx')).toContain('label="Paylaş"');
    const summary = read('app/session/summary.tsx');
    expect(summary).toContain('label="Paylaş"');
    expect(summary).toContain('recordShareCard(page)');
    const detail = read('app/session/[id].tsx');
    expect(detail).toContain("label: 'Paylaş'");
    expect(detail).toContain('<SharePreviewSheet');
  });

  it('önizlemede "Paylaş" / "Vazgeç"', () => {
    const sheet = read('src/components/SharePreviewSheet.tsx');
    expect(sheet).toContain('label="Paylaş"');
    expect(sheet).toContain('label="Vazgeç"');
  });
});

describe('gerçek SQLite: antrenman kartı', () => {
  let t: TestDb;
  let db: Db;

  beforeEach(() => {
    t = createTestDb();
    db = t.db;
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    t.close();
  });

  async function finished(exerciseId: string, startedAt: string, setSeeds: { weightKg: number; reps: number }[]) {
    vi.setSystemTime(new Date(startedAt));
    const h = await createSession(db, { exerciseId, startedAt, setSeeds: setSeeds.map((s) => ({ ...s, isCompleted: false })) });
    const base = new Date(startedAt).getTime();
    for (let i = 0; i < h.setIds.length; i += 1) {
      await db
        .update(sets)
        .set({ isCompleted: true, completedAt: new Date(base + (i + 1) * 600_000).toISOString() })
        .where(eq(sets.id, h.setIds[i]!));
    }
    vi.setSystemTime(new Date(base + 40 * 60_000));
    await finishSessionRecord(db, { sessionId: h.sessionId, sessionExerciseIds: [h.sessionExerciseId], pendingFilledIds: [], mode: 'delete' });
    return h;
  }

  it('rekorlu antrenman: istatistikler ve rekor satırı', async () => {
    const bench = await seedExercise(db, { name: 'Bench Press', nameTr: 'Göğüs Presi', primaryMuscles: '["chest"]' });
    await finished(bench, '2026-10-06T10:00:00.000Z', [{ weightKg: 80, reps: 5 }]);
    const h = await finished(bench, '2026-10-08T10:00:00.000Z', [
      { weightKg: 80, reps: 5 },
      { weightKg: 85, reps: 5 },
    ]);
    const card = (await loadWorkoutShareCard(db, h.sessionId))!;
    expect(card.records).toEqual(['Göğüs Presi · 85 kg × 5']);
    expect(card.stats.map((s) => s.label)).toEqual(['Süre', 'Hacim', 'Set']);
    expect(card.stats[2]!.value).toBe('2');
    expect(card.context).toBe('upper');
  });

  it('kardiyo bölümü: mesafe karta girer', async () => {
    const row = await seedExercise(db, { name: 'Rowing', nameTr: 'Kürek', category: 'cardio', primaryMuscles: '[]' });
    const h = await createSession(db, { exerciseId: row, startedAt: '2026-10-09T10:00:00.000Z', endedAt: '2026-10-09T10:30:00.000Z' });
    await db.insert(cardioSegments).values({ id: 'c1', sessionId: h.sessionId, exerciseId: row, orderIndex: 0, durationSeconds: 1500, distanceKm: 5 });
    const card = (await loadWorkoutShareCard(db, h.sessionId))!;
    expect(card.stats).toContainEqual({ label: 'Mesafe', value: '5 km' });
    expect(card.records).toEqual([]);
    expect(await loadWorkoutShareCard(db, 'yok')).toBeNull();
  });
});
