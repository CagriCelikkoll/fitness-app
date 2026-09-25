/**
 * Dinlenme sayacı +15 / -15.
 *
 * Eski davranış: ayar startRestTimer'ı çağırıp startedAt'i sıfırlıyordu;
 * 30 sn kalmışken -15 kalan süreyi 15 yerine 75 yapıyordu.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_REST_SECONDS,
  useActiveWorkoutStore,
} from '@/stores/activeWorkoutStore';

const T0 = 1_800_000_000_000;
let now = T0;

const store = () => useActiveWorkoutStore.getState();

/** Sayacı T0'da başlatır, `elapsedSeconds` sonrasına sarar */
function startAt(durationSeconds: number, elapsedSeconds: number) {
  now = T0;
  store().startRestTimer(durationSeconds);
  now = T0 + elapsedSeconds * 1000;
}

function remaining(): number {
  const timer = store().restTimer!;
  return timer.durationSeconds - Math.floor((now - timer.startedAt) / 1000);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  useActiveWorkoutStore.setState({ restTimer: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('adjustRestTimer', () => {
  it('startedAt değişmiyor', () => {
    startAt(90, 60);
    store().adjustRestTimer(-15);
    store().adjustRestTimer(15);
    store().adjustRestTimer(15);
    expect(store().restTimer?.startedAt).toBe(T0);
  });

  it('90 sn\'lik sayaçta 30 sn kalmışken -15 → 15 sn kalıyor', () => {
    startAt(90, 60);
    store().adjustRestTimer(-15);
    expect(store().restTimer?.durationSeconds).toBe(75);
    expect(remaining()).toBe(15);
  });

  it('+15 kalan süreyi 15 artırıyor', () => {
    startAt(90, 60);
    store().adjustRestTimer(15);
    expect(store().restTimer?.durationSeconds).toBe(105);
    expect(remaining()).toBe(45);
  });

  it('art arda basışlar birikiyor', () => {
    startAt(90, 10);
    store().adjustRestTimer(15);
    store().adjustRestTimer(15);
    store().adjustRestTimer(-15);
    expect(remaining()).toBe(80 + 15);
  });

  it('-15 kalan süreyi 0\'ın altına indirecekse sayaç bitiyor', () => {
    startAt(90, 80); // 10 sn kalmış
    store().adjustRestTimer(-15);
    expect(store().restTimer).not.toBeNull();
    expect(remaining()).toBe(0);
    // Bileşenin bitiş koşulu: geçen ms >= toplam ms
    expect(now - T0).toBeGreaterThanOrEqual(
      store().restTimer!.durationSeconds * 1000
    );
  });

  it('tam 15 sn kalmışken -15 de sayacı bitiriyor', () => {
    startAt(90, 75);
    store().adjustRestTimer(-15);
    expect(remaining()).toBe(0);
  });

  it('toplam süre 15 dakikayı geçmiyor', () => {
    startAt(MAX_REST_SECONDS - 5, 0);
    store().adjustRestTimer(15);
    expect(store().restTimer?.durationSeconds).toBe(MAX_REST_SECONDS);
    store().adjustRestTimer(15);
    expect(store().restTimer?.durationSeconds).toBe(MAX_REST_SECONDS);
  });

  it('bitmiş sayaç +15 ile canlanıp 15 sn sayıyor', () => {
    startAt(90, 92); // 2 sn önce bitti
    store().adjustRestTimer(15);
    expect(store().restTimer?.startedAt).toBe(T0);
    expect(remaining()).toBe(15);
  });

  it('bitmiş sayaçta -15 bir şey yapmıyor', () => {
    startAt(90, 92);
    const before = store().restTimer;
    store().adjustRestTimer(-15);
    expect(store().restTimer).toBe(before);
  });

  it('sayaç yokken bir şey yapmıyor', () => {
    store().adjustRestTimer(15);
    expect(store().restTimer).toBeNull();
  });

  it('saniye içindeki kesir kalan süreyi bozmuyor (bileşen gibi aşağı yuvarlıyor)', () => {
    startAt(90, 0);
    now = T0 + 60_700; // 60,7 sn geçti → ekranda 30 kalan
    store().adjustRestTimer(-15);
    expect(remaining()).toBe(15);
  });
});
