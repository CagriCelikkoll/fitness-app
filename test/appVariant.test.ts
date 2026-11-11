/**
 * v4.0a ek: "Dinç Test" uygulaması ve yasal metinlerdeki yeni yollar.
 * - `APP_VARIANT` yokken config `app.json`'ın aynısı (Play sürümü etkilenmez)
 * - `dahili` varyantı ayrı uygulama; OTA ayarları ortak; FCM yok
 * - Test sürümü OTA'dan sonra da derlemenin kanalından anlaşılır
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { HEALTH_CONSENT_TEXT, KVKK_NOTICE, LEGAL_CONTACT, PRIVACY_NOTICE_VERSION, PRIVACY_POLICY } from '@/content/legal';
import { isInternalChannel } from '@/lib/appVariant';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const json = (f: string) => JSON.parse(read(f));
const appConfig = createRequire(import.meta.url)('../app.config.js') as (ctx: { config: Base }) => Base;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = any;
const base = (): Base => json('app.json').expo;

afterEach(() => {
  vi.unstubAllEnvs();
});

function dahili(): Base {
  vi.stubEnv('APP_VARIANT', 'dahili');
  return appConfig({ config: base() });
}

describe('APP_VARIANT yok', () => {
  it('app.json olduğu gibi döner', () => {
    vi.stubEnv('APP_VARIANT', '');
    const config = base();
    expect(appConfig({ config })).toBe(config);
    expect(config).toEqual(base());
  });

  it('yanlış yazılan varyant sessizce Play ayarlarıyla derlenmez', () => {
    vi.stubEnv('APP_VARIANT', 'dahli');
    expect(() => appConfig({ config: base() })).toThrow(/APP_VARIANT/);
  });
});

describe('APP_VARIANT=dahili', () => {
  it('ayrı uygulama: ad, paket, bundle id, şema', () => {
    const c = dahili();
    expect(c.name).toBe('Dinç Test');
    expect(c.android.package).toBe('com.dincapp.antrenman.dahili');
    expect(c.ios.bundleIdentifier).toBe('com.dincapp.antrenman.dahili');
    expect(c.scheme).toBe('dinc-dahili');
  });

  it('FCM yok; yerel bildirim eklentisi ve izinler aynı', () => {
    const c = dahili();
    expect(c.android).not.toHaveProperty('googleServicesFile');
    expect(c.plugins).toEqual(base().plugins);
    expect(c.android.permissions).toEqual(base().android.permissions);
    expect(c.android.blockedPermissions).toEqual(base().android.blockedPermissions);
  });

  it('OTA ayarları ortak: sürüm, runtime politikası, EAS projesi', () => {
    const c = dahili();
    for (const key of ['version', 'runtimeVersion', 'updates', 'slug', 'extra', 'owner']) {
      expect(c[key], key).toEqual(base()[key]);
    }
    expect(c.runtimeVersion).toEqual({ policy: 'appVersion' });
  });

  it('kendi ikonları var, mevcutlarla aynı değil', () => {
    const c = dahili();
    const pairs: [string, string][] = [
      [c.icon, base().icon],
      [c.android.adaptiveIcon.foregroundImage, base().android.adaptiveIcon.foregroundImage],
      [c.android.adaptiveIcon.monochromeImage, base().android.adaptiveIcon.monochromeImage],
    ];
    for (const [test, play] of pairs) {
      expect(existsSync(path.join(ROOT, test)), test).toBe(true);
      expect(readFileSync(path.join(ROOT, test)).equals(readFileSync(path.join(ROOT, play))), test).toBe(false);
    }
  });
});

describe('eas.json dahili profili', () => {
  const profile = json('eas.json').build.dahili;

  it('spec ile aynı; sürüm sayacı artmaz', () => {
    expect(profile).toMatchObject({
      distribution: 'internal',
      channel: 'dahili',
      environment: 'production',
      android: { buildType: 'apk' },
      env: { APP_VARIANT: 'dahili' },
    });
    expect(profile.autoIncrement).toBeUndefined();
  });

  it('diğer profillerde varyant yok', () => {
    const { preview, production } = json('eas.json').build;
    expect(preview.env.APP_VARIANT).toBeUndefined();
    expect(production.env.APP_VARIANT).toBeUndefined();
  });
});

describe('uygulama içinde test sürümü', () => {
  it('yalnızca dahili kanalındaki derleme', () => {
    expect(isInternalChannel('dahili')).toBe(true);
    for (const c of ['preview', 'production', '', null, undefined]) expect(isInternalChannel(c)).toBe(false);
  });

  it('derlemenin kanalından okunuyor (expoConfig OTA manifest’inden gelir)', () => {
    const push = read('src/lib/pushNative.ts');
    expect(push).toContain('isInternalChannel(Updates.channel)');
    expect(push).toContain('PUSH_SUPPORTED && available');
    expect(push).toMatch(/askPushPermissionAfterJoin[^]*?if \(!PUSH_SUPPORTED\) return;/);
    const about = read('src/components/settings/SettingsSections.tsx');
    expect(about).toContain("isInternalChannel(Updates.channel) ? ' · Test sürümü' : ''");
  });
});

describe('yasal metinlerde yeni yollar (yazım düzeltmesi)', () => {
  const texts = [PRIVACY_POLICY, KVKK_NOTICE]
    .flatMap((d) => d.blocks.flatMap((b) => (b.kind === 'paragraph' ? [b.text] : b.items)))
    .concat(HEALTH_CONSENT_TEXT.body);

  it('eski "Ayarlar" yolu kalmadı, yenileri var', () => {
    expect(texts.filter((t) => /\bAyarlar\b/.test(t) || t.includes('Hesap ve salon'))).toEqual([]);
    const all = texts.join('\n');
    expect(all).toContain('Profil → Gizlilik ve hesap → Hesabımı sil');
    expect(all).toContain("Profil → Bildirimler'den");
    expect(all).toContain("Profil → Gizlilik ve hesap'tan");
  });

  it('aydınlatma sürümü ve yürürlük tarihi değişmedi: yeniden onay sorulmaz', () => {
    expect(PRIVACY_NOTICE_VERSION).toBe('2026-11-08');
    expect(LEGAL_CONTACT.effectiveDate).toBe('8 Kasım 2026');
  });
});
