/**
 * Ad alanı — saf mantık: normalleştirme, doğrulama (2–40, emoji tek
 * karakter), "Adını ekle" sorusunun bir kez sorulması, kayıt formu alanı.
 * Sunucu kuralları: test/integration/profile.int.ts.
 */

import { describe, expect, it } from 'vitest';

import { INITIAL_AUTH_FORM, authFormReducer } from '@/lib/auth';
import {
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

  it('2–40 karakter; emoji tek karakter', () => {
    expect(displayNameError('A')).toMatch(/en az 2/);
    expect(displayNameError(' A ')).toMatch(/en az 2/);
    expect(displayNameError('Al')).toBeNull();
    expect(displayNameError('x'.repeat(40))).toBeNull();
    expect(displayNameError('x'.repeat(41))).toMatch(/en fazla 40/);
    expect(displayNameLength('💪'.repeat(40))).toBe(40);
    expect(displayNameError('💪'.repeat(40))).toBeNull();
    expect(displayNameError('Çağrı Şükrü Öğüt')).toBeNull();
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

describe('Kayıt formu: ad alanı', () => {
  it('yazılır; başka adıma geçince silinir (e-posta kalır)', () => {
    let s = authFormReducer(INITIAL_AUTH_FORM, { type: 'switchMode', mode: 'signUp' });
    s = authFormReducer(s, { type: 'fieldChanged', field: 'email', value: 'a@b.co' });
    s = authFormReducer(s, { type: 'fieldChanged', field: 'displayName', value: 'Ayşe' });
    expect(s.displayName).toBe('Ayşe');
    s = authFormReducer(s, { type: 'switchMode', mode: 'signIn' });
    expect(s).toMatchObject({ displayName: '', email: 'a@b.co' });
  });
});
