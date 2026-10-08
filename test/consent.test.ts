/**
 * Vücut ölçüsü açık rızası (v2.2) — saf karar, kv-store kaydı ve
 * "Hepsini sil" (gerçek SQLite).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db/client';
import {
  appSettings,
  bodyMetrics,
  routines,
  sessionExercises,
  sets,
  workoutSessions,
} from '@/db/schema';
import {
  CONSENT_KEY,
  CONSENT_TEXT_VERSION,
  canUseBodyMetrics,
  consentStateFromRaw,
  countBodyMetrics,
  deleteAllBodyMetrics,
  getConsentState,
  hideBackupWarning,
  isBackupWarningHidden,
  parseConsentRecord,
  saveConsent,
  shouldAskExistingUser,
  type ConsentState,
} from '@/lib/consent';
import {
  countRows,
  createCompletedSession,
  createRoutine,
  createTestDb,
  seedExercise,
  type TestDb,
} from './helpers/testDb';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(key: string) {
      return data.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const record = (status: string, textVersion = CONSENT_TEXT_VERSION) =>
  JSON.stringify({ status, at: '2026-10-08T10:00:00.000Z', textVersion });

describe('rıza durumu', () => {
  it('anahtar yok → unknown', async () => {
    expect(consentStateFromRaw(null)).toBe('unknown');
    expect(await getConsentState(memoryStore())).toBe('unknown');
  });

  it('kayıtlı durumlar okunuyor', () => {
    expect(consentStateFromRaw(record('granted'))).toBe('granted');
    expect(consentStateFromRaw(record('declined'))).toBe('declined');
    expect(consentStateFromRaw(record('withdrawn'))).toBe('withdrawn');
  });

  it('bozuk JSON ve geçersiz içerik → unknown (çökmez)', () => {
    expect(consentStateFromRaw('{bozuk')).toBe('unknown');
    expect(consentStateFromRaw('null')).toBe('unknown');
    expect(consentStateFromRaw('"granted"')).toBe('unknown');
    expect(consentStateFromRaw(record('evet'))).toBe('unknown');
    expect(consentStateFromRaw(JSON.stringify({ status: 'granted' }))).toBe('unknown');
    expect(parseConsentRecord('[]')).toBeNull();
  });

  it('eski rıza metnine verilmiş yanıt geçersiz → unknown (yeniden sorulur)', () => {
    expect(consentStateFromRaw(record('granted', CONSENT_TEXT_VERSION - 1))).toBe('unknown');
  });

  it('giriş yalnızca granted iken açık', () => {
    const cases: [ConsentState, boolean][] = [
      ['granted', true],
      ['unknown', false],
      ['declined', false],
      ['withdrawn', false],
    ];
    for (const [state, open] of cases) expect(canUseBodyMetrics(state)).toBe(open);
  });

  it('saveConsent kv-store\'a sürümlü kayıt yazıyor', async () => {
    const store = memoryStore();
    const saved = await saveConsent(store, 'granted', new Date('2026-10-08T12:00:00.000Z'));
    expect(saved).toEqual({
      status: 'granted',
      at: '2026-10-08T12:00:00.000Z',
      textVersion: 1,
    });
    expect(JSON.parse(store.data.get(CONSENT_KEY)!)).toEqual(saved);
    expect(await getConsentState(store)).toBe('granted');

    await saveConsent(store, 'withdrawn');
    expect(await getConsentState(store)).toBe('withdrawn');
  });
});

describe('shouldAskExistingUser (açılış sorusu)', () => {
  it('unknown + kayıt var → sor', () => {
    expect(shouldAskExistingUser({ state: 'unknown', bodyMetricCount: 1 })).toBe(true);
  });

  it('unknown + kayıt yok → sorma', () => {
    expect(shouldAskExistingUser({ state: 'unknown', bodyMetricCount: 0 })).toBe(false);
  });

  it('granted / declined / withdrawn → sorma', () => {
    for (const state of ['granted', 'declined', 'withdrawn'] as const) {
      expect(shouldAskExistingUser({ state, bodyMetricCount: 5 })).toBe(false);
    }
  });
});

describe('yedek paylaşım uyarısı', () => {
  it('"Bir daha gösterme" kaydediliyor', async () => {
    const store = memoryStore();
    expect(await isBackupWarningHidden(store)).toBe(false);
    await hideBackupWarning(store);
    expect(await isBackupWarningHidden(store)).toBe(true);
  });
});

describe('Hepsini sil — gerçek SQLite', () => {
  let t: TestDb;
  let db: Db;

  beforeEach(() => {
    t = createTestDb();
    db = t.db;
  });

  afterEach(() => t.close());

  it('yalnızca vücut ölçüsü tablosu boşalıyor; profil, antrenman ve rutinler duruyor', async () => {
    await db.insert(appSettings).values({
      id: 1,
      heightCm: 180,
      birthDate: '1995-05-05',
      gender: 'male',
    });
    const exerciseId = await seedExercise(db);
    await createRoutine(db, { exerciseIds: [exerciseId] });
    await createCompletedSession(db, {
      exerciseId,
      startedAt: '2026-10-01T10:00:00.000Z',
      setSeeds: [{}, {}],
    });
    await db.insert(bodyMetrics).values([
      { id: 'm1', date: '2026-10-01', weightKg: 80, waistCm: 85 },
      { id: 'm2', date: '2026-10-05', weightKg: 79.5, bodyFatPct: 18 },
    ]);
    expect(await countBodyMetrics(db)).toBe(2);

    await deleteAllBodyMetrics(db);

    expect(await countBodyMetrics(db)).toBe(0);
    expect(await countRows(db, routines)).toBe(1);
    expect(await countRows(db, workoutSessions)).toBe(1);
    expect(await countRows(db, sessionExercises)).toBe(1);
    expect(await countRows(db, sets)).toBe(2);
    const [profile] = await db.select().from(appSettings);
    expect(profile).toMatchObject({ heightCm: 180, birthDate: '1995-05-05', gender: 'male' });
  });
});
