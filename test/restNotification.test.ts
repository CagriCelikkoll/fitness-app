/**
 * Dinlenme bildirimi planlama — saf karar, planlayıcı ve gerçek
 * `activeWorkoutStore` bağlantısı. expo-notifications yerine taklit api.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REST_NOTIFICATION_ENABLED,
  MIN_NOTIFICATION_LEAD_MS,
  REST_NOTIFICATION_ASKED_KEY,
  REST_NOTIFICATION_ENABLED_KEY,
  connectRestNotifications,
  createRestNotificationScheduler,
  ensureRestNotificationPermission,
  getRestNotificationEnabled,
  parseRestNotificationEnabled,
  restEndAtMs,
  restNotificationAction,
  restNotificationContent,
  restNotificationPermissionState,
  setRestNotificationEnabled,
  type RestNotificationApi,
  type RestNotificationContent,
  type RestNotificationScheduler,
} from '@/lib/restNotification';
import { afterSetCompleted, type SessionExerciseState } from '@/lib/superset';
import type { KeyValueStore } from '@/lib/onboarding';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
}

interface FakeApi extends RestNotificationApi {
  granted: boolean;
  requestResult: boolean;
  requests: number;
  scheduled: Map<string, { fireAtMs: number; content: RestNotificationContent }>;
  cancelled: string[];
}

function fakeApi({ granted = true, requestResult = true } = {}): FakeApi {
  let seq = 0;
  const api: FakeApi = {
    granted,
    requestResult,
    requests: 0,
    scheduled: new Map(),
    cancelled: [],
    isGranted: async () => api.granted,
    request: async () => {
      api.requests += 1;
      api.granted = api.requestResult;
      return api.requestResult;
    },
    schedule: async (fireAtMs, content) => {
      seq += 1;
      const id = `n${seq}`;
      api.scheduled.set(id, { fireAtMs, content });
      return id;
    },
    cancel: async (id) => {
      api.cancelled.push(id);
      api.scheduled.delete(id);
    },
  };
  return api;
}

/** Sıradaki planlama işi bitsin (taklit api anında dönüyor) */
const flush = () => new Promise((r) => setTimeout(r, 0));

const NOW = new Date(2026, 9, 6, 18, 0, 0).getTime();

// ============================================================================
// Ayar ve izin
// ============================================================================

describe('dinlenme bildirimi ayarı', () => {
  it('yazılmamışsa varsayılan açık', async () => {
    expect(DEFAULT_REST_NOTIFICATION_ENABLED).toBe(true);
    expect(await getRestNotificationEnabled(memoryStore())).toBe(true);
  });

  it('kapatma/açma kalıcı', async () => {
    const store = memoryStore();
    await setRestNotificationEnabled(store, false);
    expect(store.data.get(REST_NOTIFICATION_ENABLED_KEY)).toBe('0');
    expect(await getRestNotificationEnabled(store)).toBe(false);
    await setRestNotificationEnabled(store, true);
    expect(await getRestNotificationEnabled(store)).toBe(true);
  });

  it('bozuk değer varsayılana döner', () => {
    expect(parseRestNotificationEnabled('evet')).toBe(true);
    expect(parseRestNotificationEnabled(null)).toBe(true);
  });
});

describe('ensureRestNotificationPermission', () => {
  it('izin varsa sormaz', async () => {
    const api = fakeApi({ granted: true });
    const store = memoryStore();
    expect(await ensureRestNotificationPermission(api, store)).toBe(true);
    expect(api.requests).toBe(0);
    expect(store.data.has(REST_NOTIFICATION_ASKED_KEY)).toBe(false);
  });

  it('ilk seferde sorar, reddedilince bir daha sormaz', async () => {
    const api = fakeApi({ granted: false, requestResult: false });
    const store = memoryStore();
    expect(await ensureRestNotificationPermission(api, store)).toBe(false);
    expect(await ensureRestNotificationPermission(api, store)).toBe(false);
    expect(api.requests).toBe(1);
  });

  it('kabul edilirse true', async () => {
    const api = fakeApi({ granted: false, requestResult: true });
    expect(await ensureRestNotificationPermission(api, memoryStore())).toBe(true);
  });

  it('reddedildikten sonra telefon ayarlarından açılırsa sormadan true', async () => {
    const api = fakeApi({ granted: true });
    const store = memoryStore({ [REST_NOTIFICATION_ASKED_KEY]: '1' });
    expect(await ensureRestNotificationPermission(api, store)).toBe(true);
    expect(api.requests).toBe(0);
  });

  it('Ayarlar durumu', () => {
    expect(restNotificationPermissionState(true, true)).toBe('granted');
    expect(restNotificationPermissionState(false, true)).toBe('denied');
    expect(restNotificationPermissionState(false, false)).toBe('notAsked');
  });
});

// ============================================================================
// Saf karar
// ============================================================================

describe('restNotificationAction', () => {
  const timer = { startedAt: NOW, durationSeconds: 90 };
  const opts = { enabled: true, nowMs: NOW };

  it('bitiş anı = başlangıç + süre', () => {
    expect(restEndAtMs(timer)).toBe(NOW + 90_000);
    expect(restNotificationAction(null, timer, opts)).toEqual({
      kind: 'schedule',
      fireAtMs: NOW + 90_000,
    });
  });

  it('sayaç değişmediyse hiçbir şey', () => {
    expect(restNotificationAction(timer, timer, opts)).toEqual({ kind: 'none' });
    expect(restNotificationAction(timer, { ...timer }, opts)).toEqual({ kind: 'none' });
    expect(restNotificationAction(null, null, opts)).toEqual({ kind: 'none' });
  });

  it('+15 yeni bitiş anına planlar', () => {
    expect(
      restNotificationAction(timer, { ...timer, durationSeconds: 105 }, opts)
    ).toEqual({ kind: 'schedule', fireAtMs: NOW + 105_000 });
  });

  it('sayaç kalkınca iptal', () => {
    expect(restNotificationAction(timer, null, opts)).toEqual({ kind: 'cancel' });
  });

  it('ayar kapalıysa planlamaz', () => {
    expect(restNotificationAction(null, timer, { ...opts, enabled: false })).toEqual({
      kind: 'cancel',
    });
  });

  it('bitişe çok az kaldıysa (−15 ile biten sayaç) planlamaz', () => {
    const nowMs = NOW + 90_000 - MIN_NOTIFICATION_LEAD_MS + 1;
    expect(restNotificationAction(null, timer, { enabled: true, nowMs })).toEqual({
      kind: 'cancel',
    });
  });

  it('metin: "Dinlenme bitti" + sıradaki', () => {
    expect(restNotificationContent('Sıradaki: Bench Press')).toEqual({
      title: 'Dinlenme bitti',
      body: 'Sıradaki: Bench Press',
    });
    expect(restNotificationContent(null)).toEqual({ title: 'Dinlenme bitti', body: null });
  });
});

// ============================================================================
// Gerçek store + planlayıcı
// ============================================================================

describe('activeWorkoutStore bağlantısı', () => {
  let api: FakeApi;
  let store: ReturnType<typeof memoryStore>;
  let scheduler: RestNotificationScheduler;
  let disconnect: () => void;

  const s = () => useActiveWorkoutStore.getState();
  const only = () => {
    expect(api.scheduled.size).toBe(1);
    return [...api.scheduled.values()][0]!;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    api = fakeApi();
    store = memoryStore();
    scheduler = createRestNotificationScheduler(api, { store });
    disconnect = connectRestNotifications(useActiveWorkoutStore, scheduler);
    s().startSession('session-1');
  });

  afterEach(() => {
    disconnect();
    s().endSession();
    vi.useRealTimers();
  });

  it('dinlenme başlayınca bitiş anına planlanıyor', async () => {
    s().startRestTimer(90);
    await flush();
    expect(only().fireAtMs).toBe(NOW + 90_000);
  });

  it('+15 / −15 yeniden planlıyor, eski bildirim kalmıyor', async () => {
    s().startRestTimer(90);
    await flush();
    vi.setSystemTime(NOW + 10_000);

    s().adjustRestTimer(15);
    await flush();
    expect(only().fireAtMs).toBe(NOW + 105_000);

    s().adjustRestTimer(-15);
    s().adjustRestTimer(-15);
    await flush();
    expect(only().fireAtMs).toBe(NOW + 75_000);
    expect(api.cancelled).toHaveLength(3);
  });

  it('−15 sayacı bitirirse bildirim iptal', async () => {
    s().startRestTimer(30);
    await flush();
    vi.setSystemTime(NOW + 20_000);
    s().adjustRestTimer(-15);
    await flush();
    expect(api.scheduled.size).toBe(0);
  });

  it('durdurma iptal ediyor', async () => {
    s().startRestTimer(90);
    await flush();
    s().stopRestTimer();
    await flush();
    expect(api.scheduled.size).toBe(0);
    expect(api.cancelled).toEqual(['n1']);
  });

  it('antrenman bitişi iptal ediyor', async () => {
    s().startRestTimer(90);
    await flush();
    s().endSession();
    await flush();
    expect(api.scheduled.size).toBe(0);
  });

  it('yeni dinlenme eskisinin yerine geçiyor', async () => {
    s().startRestTimer(90);
    await flush();
    vi.setSystemTime(NOW + 30_000);
    s().startRestTimer(60);
    await flush();
    expect(only().fireAtMs).toBe(NOW + 90_000);
    expect(api.cancelled).toEqual(['n1']);
  });

  it('ayar kapalıysa planlanmıyor', async () => {
    await setRestNotificationEnabled(store, false);
    s().startRestTimer(90);
    await flush();
    expect(api.scheduled.size).toBe(0);
    expect(api.requests).toBe(0);
  });

  it('izin reddedilirse planlanmıyor, ikinci dinlenmede tekrar sorulmuyor', async () => {
    api.granted = false;
    api.requestResult = false;
    s().startRestTimer(90);
    await flush();
    s().stopRestTimer();
    s().startRestTimer(60);
    await flush();
    expect(api.scheduled.size).toBe(0);
    expect(api.requests).toBe(1);
  });

  it('izin ilk dinlenmede isteniyor, antrenman başlangıcında değil', async () => {
    api.granted = false;
    await flush();
    expect(api.requests).toBe(0);
    s().startRestTimer(90);
    await flush();
    expect(api.requests).toBe(1);
    expect(api.scheduled.size).toBe(1);
  });

  it('ayar kapatılınca çalışan dinlenmenin bildirimi iptal edilebiliyor', async () => {
    s().startRestTimer(90);
    await flush();
    await scheduler.cancel();
    expect(api.scheduled.size).toBe(0);
  });

  describe('süperset', () => {
    // Bench (A1) + Row (A2), ikişer set
    const exercises = (completed: string[]): SessionExerciseState[] => [
      {
        name: 'Bench Press',
        supersetGroup: 1,
        sets: ['b1', 'b2'].map((id) => ({ id, isCompleted: completed.includes(id) })),
      },
      {
        name: 'Row',
        supersetGroup: 1,
        sets: ['r1', 'r2'].map((id) => ({ id, isCompleted: completed.includes(id) })),
      },
    ];

    /** active.tsx'teki sıra: karar → metin → (gerekirse) sayaç */
    const completeSet = (currentIndex: number, completedSetId: string, done: string[]) => {
      const result = afterSetCompleted({
        exercises: exercises(done),
        currentIndex,
        completedSetId,
      });
      scheduler.setNextLabel(result.next?.label ?? null);
      if (result.startRest) s().startRestTimer(90);
      return result;
    };

    it('süperset içinde dinlenme başlamayınca bildirim planlanmıyor', async () => {
      const result = completeSet(0, 'b1', []);
      await flush();
      expect(result.startRest).toBe(false);
      expect(api.scheduled.size).toBe(0);
    });

    it('tur bitince planlanıyor, metin süperset barıyla aynı', async () => {
      completeSet(0, 'b1', []);
      const result = completeSet(1, 'r1', ['b1']);
      await flush();
      expect(result.startRest).toBe(true);
      expect(only().content).toEqual({
        title: 'Dinlenme bitti',
        body: result.next!.label,
      });
      expect(result.next!.label).toBe('Sıradaki tur: Bench Press');
    });

    it('+15 aynı metinle yeniden planlıyor; arada başka set tamamlansa da', async () => {
      completeSet(0, 'b1', []);
      completeSet(1, 'r1', ['b1']);
      await flush();
      // Dinlenme sürerken A1'in 2. seti (dinlenme başlatmıyor, yeni metin)
      completeSet(0, 'b2', ['b1', 'r1']);
      s().adjustRestTimer(15);
      await flush();
      expect(only().content.body).toBe('Sıradaki tur: Bench Press');
    });

    it('süperset olmayan harekette metin yok', async () => {
      const result = afterSetCompleted({
        exercises: [{ name: 'Squat', supersetGroup: null, sets: [{ id: 's1', isCompleted: false }] }],
        currentIndex: 0,
        completedSetId: 's1',
      });
      scheduler.setNextLabel(result.next?.label ?? null);
      s().startRestTimer(90);
      await flush();
      expect(only().content).toEqual({ title: 'Dinlenme bitti', body: null });
    });
  });
});
