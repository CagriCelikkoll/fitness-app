/**
 * 0.13 Bölüm 7: premium altyapısı (gizli).
 * - Bayrak kapalı; kapalıyken kütüphane başlamaz, modül yüklenmez
 * - `usePremium()` kapalıyken her zaman "premium değil"
 * - Hesap eşleme (logIn / logOut), anahtar biçimi, gizli anahtar yok
 * - Ödeme duvarı yalnızca iskelet; menülerde giriş yok
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PREMIUM_ENABLED,
  PREMIUM_ENTITLEMENT,
  PREMIUM_OFF,
  isPremiumFromCustomerInfo,
  premiumResult,
  purchasesIdentityAction,
  revenueCatApiKey,
  shouldStartPurchases,
} from '@/lib/premium';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx|js)$/.test(name)) out.push(rel.replace(/\\/g, '/'));
  }
  return out;
}
const APP_SOURCES = [...sourceFiles('src'), ...sourceFiles('app')];

const ANDROID_KEY = 'goog_AbCdEfGhIjKlMnOpQrStUvWxYz1';
const IOS_KEY = 'appl_AbCdEfGhIjKlMnOpQrStUvWxYz1';

describe('bayrak', () => {
  it('bu sürümde kapalı', () => {
    expect(PREMIUM_ENABLED).toBe(false);
  });

  it('kapalıyken anahtar olsa da başlamaz; açıkken anahtarsız da başlamaz', () => {
    expect(shouldStartPurchases({ enabled: false, apiKey: ANDROID_KEY })).toBe(false);
    expect(shouldStartPurchases({ enabled: false, apiKey: null })).toBe(false);
    expect(shouldStartPurchases({ enabled: true, apiKey: null })).toBe(false);
    expect(shouldStartPurchases({ enabled: true, apiKey: ANDROID_KEY })).toBe(true);
  });

  it('usePremium sonucu: kapalıyken saklanan durum premium olsa da "premium değil"', () => {
    expect(premiumResult(false, { isPremium: true, ready: true })).toEqual({ isPremium: false, ready: true });
    expect(premiumResult(false, { isPremium: false, ready: false })).toBe(PREMIUM_OFF);
    expect(premiumResult(true, { isPremium: true, ready: true })).toEqual({ isPremium: true, ready: true });
    const hook = read('src/hooks/usePremium.ts');
    expect(hook).toContain('return premiumResult(PREMIUM_ENABLED, state);');
    expect(hook).toMatch(/if \(!PREMIUM_ENABLED \|\| !ready\) return;/);
  });
});

describe('kütüphane yüklenmesi', () => {
  it('react-native-purchases hiçbir yerde içe aktarılmıyor; yalnızca başlatma koşulundan sonra require', () => {
    for (const f of APP_SOURCES) {
      expect(read(f), f).not.toMatch(/^import [^;]*from 'react-native-purchases'/m);
      if (f !== 'src/lib/purchasesNative.ts') expect(read(f), f).not.toContain("require('react-native-purchases')");
    }
    const native = read('src/lib/purchasesNative.ts');
    const guard = native.indexOf('if (!shouldStartPurchases({ enabled: PREMIUM_ENABLED, apiKey: API_KEY })) return');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(native.indexOf("require('react-native-purchases')"));
  });
});

describe('anahtar', () => {
  it('platforma göre herkese açık SDK anahtarı; gizli anahtar ya da bozuk biçim reddedilir', () => {
    const keys = { android: ANDROID_KEY, ios: IOS_KEY };
    expect(revenueCatApiKey('android', keys)).toBe(ANDROID_KEY);
    expect(revenueCatApiKey('ios', keys)).toBe(IOS_KEY);
    expect(revenueCatApiKey('web', keys)).toBeNull();
    expect(revenueCatApiKey('android', { android: IOS_KEY, ios: null })).toBeNull();
    expect(revenueCatApiKey('android', { android: 'sk_gizli0123456789', ios: null })).toBeNull();
    expect(revenueCatApiKey('android', { android: undefined, ios: null })).toBeNull();
    expect(revenueCatApiKey('android', { android: ` ${ANDROID_KEY}\n`, ios: null })).toBe(ANDROID_KEY);
  });

  it('anahtarlar yalnızca ortam değişkeninden; projede RevenueCat anahtarı yok', () => {
    const native = read('src/lib/purchasesNative.ts');
    expect(native).toContain('process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY');
    expect(native).toContain('process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY');
    const all = [...APP_SOURCES, 'app.json', 'app.config.js', 'eas.json'].map(read).join('\n');
    expect(all).not.toMatch(/\b(goog|appl|sk)_[A-Za-z0-9]{20,}/);
  });
});

describe('yetki ve hesap eşleme', () => {
  it('premium yalnızca aktif "premium" yetkisiyle', () => {
    expect(PREMIUM_ENTITLEMENT).toBe('premium');
    expect(isPremiumFromCustomerInfo({ entitlements: { active: { premium: {} } } })).toBe(true);
    expect(isPremiumFromCustomerInfo({ entitlements: { active: { baska: {} } } })).toBe(false);
    expect(isPremiumFromCustomerInfo(null)).toBe(false);
  });

  it('girişte logIn (Supabase kimliği), çıkışta logOut, değişmediyse hiçbir şey', () => {
    expect(purchasesIdentityAction(null, 'u1')).toEqual({ kind: 'logIn', userId: 'u1' });
    expect(purchasesIdentityAction('u1', 'u2')).toEqual({ kind: 'logIn', userId: 'u2' });
    expect(purchasesIdentityAction('u1', null)).toEqual({ kind: 'logOut' });
    expect(purchasesIdentityAction('u1', 'u1')).toBeNull();
    // Hesapsız: anonim kalır
    expect(purchasesIdentityAction(null, null)).toBeNull();
  });

  it('kökte bağlı; antrenman ekranına dokunulmadı', () => {
    expect(read('app/_layout.tsx')).toContain('usePurchasesSync();');
    expect(read('app/session/active.tsx')).not.toMatch(/premium|Purchases/i);
  });
});

describe('ödeme duvarı', () => {
  it('iskelet rota var; menülerde ya da başka ekranda giriş yok', () => {
    expect(read('app/premium.tsx')).toContain('export default function PremiumScreen');
    for (const f of APP_SOURCES) {
      if (f === 'app/premium.tsx') continue;
      expect(read(f), f).not.toMatch(/['"`]\/premium['"`]|pathname: ['"]\/premium/);
    }
  });
});
