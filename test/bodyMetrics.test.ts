import { describe, expect, it } from 'vitest';

import {
  bmiCategory,
  calculateAge,
  calculateBmi,
  calculateBmr,
  leanBodyMass,
  waistToHeightRatio,
} from '@/lib/bodyMetrics';

describe('calculateBmi', () => {
  it('bilinen değeri doğru hesaplıyor (82.5 kg / 178 cm ≈ 26.0)', () => {
    expect(calculateBmi(82.5, 178)).toBeCloseTo(26.04, 2);
  });

  it('70 kg / 175 cm ≈ 22.86', () => {
    expect(calculateBmi(70, 175)).toBeCloseTo(22.86, 2);
  });

  it('eksik/geçersiz girdide null', () => {
    expect(calculateBmi(0, 178)).toBeNull();
    expect(calculateBmi(82.5, 0)).toBeNull();
    expect(calculateBmi(-5, 178)).toBeNull();
    expect(calculateBmi(NaN, 178)).toBeNull();
    expect(calculateBmi(82.5, Infinity)).toBeNull();
  });
});

describe('bmiCategory', () => {
  it('sınır değerler kendi kategorilerine ait (WHO eşikleri)', () => {
    expect(bmiCategory(18.49)).toBe('Zayıf');
    expect(bmiCategory(18.5)).toBe('Normal');
    expect(bmiCategory(24.99)).toBe('Normal');
    expect(bmiCategory(25)).toBe('Fazla kilolu');
    expect(bmiCategory(29.99)).toBe('Fazla kilolu');
    expect(bmiCategory(30)).toBe('Obez');
  });

  it('geçersiz VKİ için null', () => {
    expect(bmiCategory(0)).toBeNull();
    expect(bmiCategory(-1)).toBeNull();
    expect(bmiCategory(NaN)).toBeNull();
  });
});

describe('waistToHeightRatio', () => {
  it('bel / boy oranını döndürüyor', () => {
    expect(waistToHeightRatio(85, 178)).toBeCloseTo(0.4775, 4);
    expect(waistToHeightRatio(89, 178)).toBe(0.5);
  });

  it('eksik girdide null', () => {
    expect(waistToHeightRatio(0, 178)).toBeNull();
    expect(waistToHeightRatio(85, 0)).toBeNull();
  });
});

describe('calculateAge', () => {
  it('doğum günü bu yıl geçmişse tam yaş', () => {
    // 15 Mart doğumlu, bugün 16 Eylül → 36
    expect(calculateAge('1990-03-15', new Date(2026, 8, 16))).toBe(36);
  });

  it('doğum günü bu yıl geçmemişse bir eksik', () => {
    // 15 Aralık doğumlu, bugün 16 Eylül → 35
    expect(calculateAge('1990-12-15', new Date(2026, 8, 16))).toBe(35);
  });

  it('doğum gününün tam günü yaşı artırıyor', () => {
    expect(calculateAge('1990-09-16', new Date(2026, 8, 16))).toBe(36);
    expect(calculateAge('1990-09-17', new Date(2026, 8, 16))).toBe(35);
  });

  it('takvimde olmayan tarih null', () => {
    expect(calculateAge('1990-02-30', new Date(2026, 8, 16))).toBeNull();
    expect(calculateAge('1990-13-01', new Date(2026, 8, 16))).toBeNull();
  });

  it('biçimsiz girdide null, hata fırlatmıyor', () => {
    expect(calculateAge('', new Date(2026, 8, 16))).toBeNull();
    expect(calculateAge('15.03.1990', new Date(2026, 8, 16))).toBeNull();
    expect(calculateAge('1990-3-5', new Date(2026, 8, 16))).toBeNull();
  });

  it('ileri tarih (negatif yaş) ve 130+ yaş null', () => {
    expect(calculateAge('2030-01-01', new Date(2026, 8, 16))).toBeNull();
    expect(calculateAge('1850-01-01', new Date(2026, 8, 16))).toBeNull();
  });
});

describe('calculateBmr (Mifflin-St Jeor)', () => {
  // 10*80 + 6.25*180 - 5*30 = 800 + 1125 - 150 = 1775
  it('erkek için +5', () => {
    expect(calculateBmr(80, 180, 30, 'male')).toBeCloseTo(1780, 5);
  });

  it('kadın için -161', () => {
    expect(calculateBmr(80, 180, 30, 'female')).toBeCloseTo(1614, 5);
  });

  it('cinsiyet belirtilmemişse null', () => {
    expect(calculateBmr(80, 180, 30, 'unspecified')).toBeNull();
    expect(calculateBmr(80, 180, 30, '')).toBeNull();
  });

  it('eksik/geçersiz girdide null', () => {
    expect(calculateBmr(0, 180, 30, 'male')).toBeNull();
    expect(calculateBmr(80, 0, 30, 'male')).toBeNull();
    expect(calculateBmr(80, 180, -1, 'male')).toBeNull();
    expect(calculateBmr(80, 180, NaN, 'male')).toBeNull();
  });
});

describe('leanBodyMass', () => {
  it('yağ yüzdesini çıkarıyor', () => {
    expect(leanBodyMass(80, 20)).toBeCloseTo(64, 5);
    expect(leanBodyMass(80, 0)).toBeCloseTo(80, 5);
  });

  it('geçersiz yağ yüzdesinde null', () => {
    expect(leanBodyMass(80, -1)).toBeNull();
    expect(leanBodyMass(80, 100)).toBeNull();
    expect(leanBodyMass(80, NaN)).toBeNull();
  });

  it('geçersiz kiloda null', () => {
    expect(leanBodyMass(0, 20)).toBeNull();
  });
});
