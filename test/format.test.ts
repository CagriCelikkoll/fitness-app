import { describe, expect, it } from 'vitest';

import {
  dateKeyToParts,
  formatDateKey,
  formatShortDate,
  isValidCalendarDate,
  isValidDateKey,
  partsToDateKey,
  sanitizeDecimalInput,
  toDateKey,
} from '@/lib/format';

describe('partsToDateKey / dateKeyToParts', () => {
  it('gidiş-dönüş aynı değeri veriyor', () => {
    const key = '2026-09-14';
    const parts = dateKeyToParts(key);
    expect(parts).toEqual({ day: '14', month: '09', year: '2026' });
    expect(partsToDateKey(parts)).toBe(key);
  });

  it('tek haneli gün/ay sıfırla dolduruluyor', () => {
    expect(partsToDateKey({ day: '5', month: '9', year: '2026' })).toBe(
      '2026-09-05'
    );
  });

  it('eksik alan null', () => {
    expect(partsToDateKey({ day: '', month: '9', year: '2026' })).toBeNull();
    expect(partsToDateKey({ day: '5', month: '', year: '2026' })).toBeNull();
    expect(partsToDateKey({ day: '5', month: '9', year: '' })).toBeNull();
    expect(partsToDateKey({ day: '5', month: '9', year: '26' })).toBeNull();
  });
});

describe('takvim doğrulaması', () => {
  it('olmayan günleri reddediyor', () => {
    expect(partsToDateKey({ day: '30', month: '2', year: '2026' })).toBeNull();
    expect(partsToDateKey({ day: '31', month: '4', year: '2026' })).toBeNull();
    expect(partsToDateKey({ day: '29', month: '2', year: '2025' })).toBeNull();
  });

  it('artık yıllarda 29 Şubat kabul ediliyor', () => {
    expect(partsToDateKey({ day: '29', month: '2', year: '2024' })).toBe(
      '2024-02-29'
    );
    expect(partsToDateKey({ day: '29', month: '2', year: '2000' })).toBe(
      '2000-02-29'
    );
  });

  it('1900 artık yıl değil (400 kuralı)', () => {
    expect(partsToDateKey({ day: '29', month: '2', year: '1900' })).toBeNull();
    expect(isValidCalendarDate(1900, 2, 29)).toBe(false);
    expect(isValidCalendarDate(1900, 2, 28)).toBe(true);
  });

  it('isValidDateKey biçim ve takvimi birlikte kontrol ediyor', () => {
    expect(isValidDateKey('2024-02-29')).toBe(true);
    expect(isValidDateKey('2025-02-29')).toBe(false);
    expect(isValidDateKey('2025-2-9')).toBe(false);
    expect(isValidDateKey('abc')).toBe(false);
  });
});

describe('toDateKey yerel saat', () => {
  it('gece yarısına yakın saatlerde gün kaymıyor', () => {
    // Yerel 23:30; UTC'ye çevrilseydi bazı zaman dilimlerinde ertesi gün olurdu
    expect(toDateKey(new Date(2026, 8, 14, 23, 30))).toBe('2026-09-14');
    // Yerel 00:30; UTC'ye çevrilseydi bazı zaman dilimlerinde önceki gün olurdu
    expect(toDateKey(new Date(2026, 8, 14, 0, 30))).toBe('2026-09-14');
  });

  it('ay/gün tek haneliyken sıfırla dolduruluyor', () => {
    expect(toDateKey(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('formatDateKey ayrıştırarak çeviriyor (UTC kayması yok)', () => {
    expect(formatDateKey('2026-01-05')).toBe('05.01.2026');
  });
});

describe('sanitizeDecimalInput', () => {
  it('harfleri ve eksi işaretini atıyor', () => {
    expect(sanitizeDecimalInput('8a2', '')).toBe('82');
    expect(sanitizeDecimalInput('-5', '')).toBe('5');
    expect(sanitizeDecimalInput('82,5kg', '82,5')).toBe('82,5');
  });

  it('ikinci ayırıcıyı yok sayıp önceki değeri döndürüyor', () => {
    expect(sanitizeDecimalInput('1,2.3', '1,2')).toBe('1,2');
    expect(sanitizeDecimalInput('1.2.3', '1.2')).toBe('1.2');
  });

  it('"1,2,3" harf harf yazıldığında "1,2" kalıyor', () => {
    let value = '';
    for (const ch of '1,2,3') {
      value = sanitizeDecimalInput(value + ch, value);
    }
    expect(value).toBe('1,2');
  });

  it('ondalık hane sınırını aşan girişi reddediyor', () => {
    expect(sanitizeDecimalInput('1,23', '1,2')).toBe('1,2');
    expect(sanitizeDecimalInput('1,23', '1,2', 2)).toBe('1,23');
  });

  it('tam sayı kısmı sınırsız', () => {
    expect(sanitizeDecimalInput('123456', '12345')).toBe('123456');
  });

  it('kayıtlı fazla ondalıklı değer kırpılmıyor, silinebiliyor', () => {
    // 2 haneli kayıt, sınır 1: hane artmadığı sürece düzenlenebilir
    expect(sanitizeDecimalInput('82,55', '82,55')).toBe('82,55');
    expect(sanitizeDecimalInput('82,5', '82,55')).toBe('82,5');
    // ama hane artırmaya çalışmak reddediliyor
    expect(sanitizeDecimalInput('82,555', '82,55')).toBe('82,55');
  });

  it('boş giriş boş kalıyor', () => {
    expect(sanitizeDecimalInput('', '82,5')).toBe('');
  });
});

describe('formatShortDate', () => {
  const now = new Date(2026, 8, 25);

  it('bu yıl: "12 Eyl"', () => {
    expect(formatShortDate(new Date(2026, 8, 12, 10).toISOString(), now)).toBe(
      '12 Eyl'
    );
  });

  it('başka yıl: yıl ekleniyor', () => {
    expect(formatShortDate(new Date(2025, 0, 3, 10).toISOString(), now)).toBe(
      '3 Oca 2025'
    );
  });
});
