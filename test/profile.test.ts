/**
 * Ad alanı — saf mantık: normalleştirme, doğrulama (v3.7: 1–40; harf,
 * rakam, boşluk, . - '), "Adını ekle" sorusunun bir kez sorulması.
 * Sunucu kuralları: test/integration/profile.int.ts.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DISPLAY_NAME_CHARS_ERROR,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  displayNameError,
  displayNameLength,
  displayNameValue,
  markNamePrompted,
  namePromptKey,
  normalizeDisplayName,
  shouldPromptForName,
  wasNamePrompted,
} from '@/lib/profile';

describe('Ad: normalleştirme ve doğrulama', () => {
  it('baş / son ve fazla boşluk, satır sonu temizlenir', () => {
    expect(normalizeDisplayName('  Ayşe   Yılmaz \n')).toBe('Ayşe Yılmaz');
    expect(normalizeDisplayName('Ali\tVeli')).toBe('Ali Veli');
    expect(displayNameValue('   ')).toBeNull();
    expect(displayNameValue(' Can ')).toBe('Can');
  });

  it('isteğe bağlıyken boş geçerli; zorunluyken değil', () => {
    expect(displayNameError('')).toBeNull();
    expect(displayNameError('   ')).toBeNull();
    expect(displayNameError('', { required: true })).toBe('Adını yaz.');
  });

  it('1–40 karakter (v3.7)', () => {
    expect(displayNameError('A')).toBeNull();
    expect(displayNameError(' A ')).toBeNull();
    expect(displayNameError('x'.repeat(40))).toBeNull();
    expect(displayNameError('x'.repeat(41))).toMatch(/en fazla 40/);
    expect(displayNameLength('Ş'.repeat(40))).toBe(40);
  });

  it('harf (Türkçe dahil), rakam, boşluk ve . - \' kabul (DNC-04)', () => {
    for (const ok of ['Çağrı Şükrü Öğüt', 'İsmail Işık', "O'Brien", 'Ayşe K.', 'Ali-Veli 2', 'José Müller', 'Ünal Çelik Jr.']) {
      expect(displayNameError(ok), ok).toBeNull();
    }
  });

  it('<, >, emoji ve diğer işaretler reddedilir; anlaşılır hata', () => {
    for (const bad of ['<script>', 'Ali <b>', 'a>b', 'Ali💪', 'Ali@Veli', 'Ali_Veli', 'Ali & Veli', '"Ali"', 'Ali;']) {
      expect(displayNameError(bad), bad).toBe(DISPLAY_NAME_CHARS_ERROR);
    }
    expect(DISPLAY_NAME_CHARS_ERROR).toBe("Adında yalnızca harf, rakam, boşluk ve . - ' kullanabilirsin.");
  });

  it('telefon klavyesinin akıllı kesme işareti düz olur; ayrık harf birleşir (NFC)', () => {
    expect(normalizeDisplayName('O’Brien')).toBe("O'Brien");
    expect(displayNameError('O’Brien')).toBeNull();
    // "g" + birleşik breve (U+0306) → "ğ"
    expect(normalizeDisplayName('Doğan')).toBe('Doğan');
    expect(displayNameError('Doğan')).toBeNull();
  });

  it('kontrol karakterleri boşluğa döner, ad yine geçerli', () => {
    expect(normalizeDisplayName('Ali\u0000Veli')).toBe('Ali Veli');
  });
});

describe('"Adını ekle" sorusu', () => {
  const base = { inGym: true, displayName: null, loaded: true, prompted: false };

  it('salonda, adı yok, sorulmamış → sorulur', () => {
    expect(shouldPromptForName(base)).toBe(true);
  });

  it('salonda değilse, adı varsa, sorulduysa ya da ad henüz okunmadıysa sorulmaz', () => {
    expect(shouldPromptForName({ ...base, inGym: false })).toBe(false);
    expect(shouldPromptForName({ ...base, displayName: 'Ayşe' })).toBe(false);
    expect(shouldPromptForName({ ...base, prompted: true })).toBe(false);
    expect(shouldPromptForName({ ...base, loaded: false })).toBe(false);
  });

  it('"soruldu" kullanıcıya göre kalıcı', async () => {
    const data = new Map<string, string>();
    const store = {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
    };
    expect(await wasNamePrompted(store, 'u1')).toBe(false);
    await markNamePrompted(store, 'u1');
    expect(await wasNamePrompted(store, 'u1')).toBe(true);
    expect(await wasNamePrompted(store, 'u2')).toBe(false);
    expect(data.has(namePromptKey('u1'))).toBe(true);
    // Depo okunamazsa sorulmuş sayılmaz (kart çıkar, zarar yok)
    const broken = { getItem: async () => Promise.reject(new Error('x')), setItem: async () => {} };
    expect(await wasNamePrompted(broken, 'u1')).toBe(false);
  });
});

describe('Sunucu kısıtı ile aynı kural', () => {
  it('0014 migration ad kısıtı: 1–40, harf / rakam / boşluk / . - \'', () => {
    const sql = readFileSync(path.join(__dirname, '../supabase/migrations/0014_auth_hardening.sql'), 'utf8');
    expect(sql).toContain('char_length(display_name) between 1 and 40');
    expect(sql).toContain("display_name ~ '^[[:alpha:][:digit:] .''-]+$'");
    expect(DISPLAY_NAME_MIN).toBe(1);
    expect(DISPLAY_NAME_MAX).toBe(40);
  });
});
