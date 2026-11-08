import { describe, expect, it } from 'vitest';

import { GLOW_STOPS, glowBox, glowVisible } from '@/lib/glow';
import { TICK_COUNT, litTicks, restRemainingFraction, restRingLabel, spokenDuration, tickGeometry } from '@/lib/tickRing';

describe('çentikli halka (v4.0a 1.6)', () => {
  it('60 çentik; ilerlemeye göre boyanan sayı', () => {
    expect(TICK_COUNT).toBe(60);
    expect(litTicks(0)).toBe(0);
    expect(litTicks(0.5)).toBe(30);
    expect(litTicks(1)).toBe(60);
    expect(litTicks(1.4)).toBe(60);
    expect(litTicks(-1)).toBe(0);
    expect(litTicks(Number.NaN)).toBe(0);
  });

  it("saat 12'den başlar, saat yönünde boyanır", () => {
    const ticks = tickGeometry(270, 22, 0.25);
    expect(ticks).toHaveLength(60);
    // ilk çentik tepede, dikey
    expect(ticks[0]).toMatchObject({ x1: 135, x2: 135, on: true });
    expect(ticks[0]!.y2).toBeLessThan(ticks[0]!.y1);
    expect(ticks[0]!.y1 - ticks[0]!.y2).toBeCloseTo(22, 5);
    // 15. çentik saat 3 yönünde (sağda)
    expect(ticks[15]!.x2).toBeGreaterThan(260);
    expect(ticks.filter((t) => t.on)).toHaveLength(15);
    expect(ticks[14]!.on).toBe(true);
    expect(ticks[15]!.on).toBe(false);
  });

  it('ekran okuyucu etiketi', () => {
    expect(restRingLabel(84)).toBe('Dinlenme: 1 dakika 24 saniye kaldı');
    expect(spokenDuration(45)).toBe('45 saniye');
    expect(spokenDuration(120)).toBe('2 dakika');
    expect(spokenDuration(-3)).toBe('0 saniye');
  });
});

describe('ortam ışığı (v4.0a 1.3)', () => {
  it('ölçüler ve opaklıklar', () => {
    const box = glowBox(400);
    expect(box.width).toBe(520);
    expect(box.left).toBe(-60);
    expect(box.height).toBe(420);
    expect(box.cx).toBe(260);
    expect(box.cy).toBeCloseTo(147, 5);
    expect(GLOW_STOPS.map((s) => [s.offset, s.opacity])).toEqual([
      [0, 0.4],
      [0.48, 0.1],
      [0.72, 0],
      [1, 0],
    ]);
  });

  it('açık temada ışık yok', () => {
    expect(glowVisible('dark')).toBe(true);
    expect(glowVisible('light')).toBe(false);
  });
});

describe('dinlenme halkası: kalan süre (drain)', () => {
  it('başta 60 çentiğin hepsi renkli, bitince hiçbiri', () => {
    expect(tickGeometry(270, 22, restRemainingFraction(90, 90), 2, TICK_COUNT, 'drain').every((t) => t.on)).toBe(true);
    expect(tickGeometry(270, 22, restRemainingFraction(0, 90), 2, TICK_COUNT, 'drain').some((t) => t.on)).toBe(false);
  });

  it('saat yönünde söner: saat 12’den başlayan çentikler önce kapanır', () => {
    // 90 sn'nin 30'u geçti → 40 renkli; ilk 20 sönük, son 40 renkli
    const ticks = tickGeometry(270, 22, restRemainingFraction(60, 90), 2, TICK_COUNT, 'drain');
    expect(ticks.filter((t) => t.on)).toHaveLength(40);
    expect(ticks.slice(0, 20).every((t) => !t.on)).toBe(true);
    expect(ticks.slice(20).every((t) => t.on)).toBe(true);
  });

  it('+15 sn toplamı büyütünce oran yeniden hesaplanır', () => {
    // 60 sn'lik dinlenmede 30 sn kaldı → yarısı; +15 → 45 / 75
    expect(restRemainingFraction(30, 60)).toBe(0.5);
    expect(restRemainingFraction(45, 75)).toBeCloseTo(0.6, 5);
    expect(litTicks(restRemainingFraction(45, 75))).toBe(36);
  });

  it('sınırlar', () => {
    expect(restRemainingFraction(10, 0)).toBe(0);
    expect(restRemainingFraction(-5, 60)).toBe(0);
    expect(restRemainingFraction(80, 60)).toBe(1);
  });

  it('fill (varsayılan) değişmedi', () => {
    const ticks = tickGeometry(80, 9, 0.25);
    expect(ticks.slice(0, 15).every((t) => t.on)).toBe(true);
    expect(ticks.slice(15).some((t) => t.on)).toBe(false);
  });
});
