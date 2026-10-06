/**
 * RIR gösterim biçimi — "Son antrenman" kutusu ve seans detayı.
 */

import { describe, expect, it } from 'vitest';

import { RIR_OPTIONS, formatSetSummary, rirLabel } from '@/lib/rir';

describe('formatSetSummary', () => {
  it('RIR varsa "@" ile ekliyor', () => {
    expect(formatSetSummary(80, 8, 2)).toBe('80kg × 8 @2');
  });

  it('RIR yoksa eski biçim', () => {
    expect(formatSetSummary(80, 8, null)).toBe('80kg × 8');
  });

  it('RIR 0 (tükeniş) gösteriliyor, yok sayılmıyor', () => {
    expect(formatSetSummary(80, 8, 0)).toBe('80kg × 8 @0');
  });

  it('4 ve üstü "4+"', () => {
    expect(formatSetSummary(80, 8, 4)).toBe('80kg × 8 @4+');
    expect(formatSetSummary(80, 8, 6)).toBe('80kg × 8 @4+');
  });

  it('eksik ağırlık/tekrar "-"', () => {
    expect(formatSetSummary(null, 12, null)).toBe('-kg × 12');
  });
});

describe('rirLabel', () => {
  it('seçici değerleri 0 1 2 3 4+', () => {
    expect(RIR_OPTIONS.map(rirLabel)).toEqual(['0', '1', '2', '3', '4+']);
  });
});
