/**
 * Google Play hazırlığı (v3.4): izinler, tam zamanlı alarm açıklaması,
 * gizlilik bağlantıları ve metni, mağaza derlemesi ayarları.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { KVKK_NOTICE, LEGAL_CONTACT, LEGAL_URLS, PRIVACY_POLICY, type LegalDocument } from '@/content/legal';
import { EXACT_ALARM_HINT, shouldShowExactAlarmHint } from '@/lib/restNotification';

const ROOT = path.resolve(__dirname, '..');
const readJson = (name: string) => JSON.parse(readFileSync(path.join(ROOT, name), 'utf8'));

const app = readJson('app.json').expo;
const eas = readJson('eas.json');
const pkg = readJson('package.json');

const plain = (doc: LegalDocument) =>
  doc.blocks.map((b) => (b.kind === 'paragraph' ? b.text : b.items.join('\n'))).join('\n');

describe('tam zamanlı alarm izni yoksa', () => {
  it('açıklama yalnızca Android 14+ telefonda, bildirim açık ve izinliyken', () => {
    expect(shouldShowExactAlarmHint('android', 34, true, 'granted')).toBe(true);
    expect(shouldShowExactAlarmHint('android', 36, true, 'granted')).toBe(true);
    // 12–13: izin kurulumda verili
    expect(shouldShowExactAlarmHint('android', 33, true, 'granted')).toBe(false);
    expect(shouldShowExactAlarmHint('android', 31, true, 'granted')).toBe(false);
    // Bildirim kapalı / izin yok: önce o çözülmeli, alarm notu gereksiz
    expect(shouldShowExactAlarmHint('android', 34, false, 'granted')).toBe(false);
    expect(shouldShowExactAlarmHint('android', 34, true, 'denied')).toBe(false);
    expect(shouldShowExactAlarmHint('android', 34, true, null)).toBe(false);
    expect(shouldShowExactAlarmHint('ios', '18.0', true, 'granted')).toBe(false);
  });

  it('metin bildirimin yine geldiğini ve gecikebileceğini söylüyor', () => {
    expect(EXACT_ALARM_HINT).toMatch(/yine gelir/);
    expect(EXACT_ALARM_HINT).toMatch(/gecikebilir/);
    expect(EXACT_ALARM_HINT).toMatch(/Alarmlar ve hatırlatıcılar/);
  });
});

describe('izinler (app.json)', () => {
  const permissions: string[] = app.android.permissions ?? [];
  const blocked: string[] = app.android.blockedPermissions ?? [];

  it('USE_EXACT_ALARM yok (Play yalnızca alarm/takvim uygulamasına veriyor); SCHEDULE_EXACT_ALARM var', () => {
    expect(permissions).toContain('android.permission.SCHEDULE_EXACT_ALARM');
    expect(permissions).not.toContain('android.permission.USE_EXACT_ALARM');
    expect(blocked).toContain('android.permission.USE_EXACT_ALARM');
  });

  it('fotoğraf / depolama izni yok: logo sistem fotoğraf seçicisiyle', () => {
    for (const p of [
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_VIDEO',
      'READ_MEDIA_VISUAL_USER_SELECTED',
    ]) {
      expect(blocked).toContain(`android.permission.${p}`);
    }
  });

  it('mikrofon, konum, ön plan servisi, reklam kimliği engelli', () => {
    for (const p of [
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'com.google.android.gms.permission.AD_ID',
    ]) {
      expect(blocked).toContain(p);
    }
    expect(permissions.filter((p) => blocked.includes(p))).toEqual([]);
  });

  it('kamera (v3.6c) yalnızca salon girişi QR için: engelli değil, mikrofon kapalı, açıklama Türkçe', () => {
    expect(blocked).not.toContain('android.permission.CAMERA');
    const plugins = app.plugins as unknown[];
    const camera = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-camera') as [string, Record<string, unknown>];
    expect(camera[1]).toMatchObject({
      cameraPermission: 'Salon girişindeki QR kodu okumak için.',
      microphonePermission: false,
      recordAudioAndroid: false,
    });
    // Görsel seçici kamerayı engellemesin (yoksa expo-camera'nın izni de kalkar)
    const picker = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker') as [string, Record<string, unknown>];
    expect(picker[1].cameraPermission).not.toBe(false);
    expect(picker[1].microphonePermission).toBe(false);
  });

  it('istenen ama engellenen izin yok; bildirim izni engellenmemiş', () => {
    expect(blocked).not.toContain('android.permission.POST_NOTIFICATIONS');
    expect(blocked).not.toContain('android.permission.SCHEDULE_EXACT_ALARM');
  });
});

describe('gizlilik bağlantıları ve metni', () => {
  it('bağlantılar yayındaki https sayfaları', () => {
    expect(LEGAL_URLS.privacy).toBe('https://cagricelikkoll.github.io/dinc-legal/');
    expect(LEGAL_URLS.accountDeletion).toBe('https://cagricelikkoll.github.io/dinc-legal/hesap-sil.html');
  });

  it('iletişim bilgisi doldurulmuş (yer tutucu yok)', () => {
    for (const v of Object.values(LEGAL_CONTACT)) expect(v).not.toMatch(/^\[/);
    expect(LEGAL_CONTACT.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
  });

  it('uygulama içi özet web sayfasındaki yeni maddeleri içeriyor', () => {
    const text = plain(PRIVACY_POLICY);
    for (const term of ['push token', 'Firebase', 'Expo', 'Supabase', 'logo', 'fotoğraf seçici', 'Hesabımı sil']) {
      expect(text).toContain(term);
    }
    // Eski "sunucu yok" iddiası kalmamalı
    expect(text).not.toMatch(/Sunucumuz yoktur|Hesap açman gerekmez/);
  });

  it('KVKK metni hesap açan kullanıcı için aktarımı söylüyor', () => {
    const text = plain(KVKK_NOTICE);
    expect(text).toContain('Supabase');
    expect(text).toContain('yurt dışına aktarım');
    expect(text).not.toMatch(/Verilerin veri sorumlusuna, yurt içinde veya yurt dışında herhangi/);
  });
});

describe('mağaza derlemesi', () => {
  it('production: AAB, otomatik artan versionCode (EAS sunucusunda), Supabase env', () => {
    expect(eas.cli.appVersionSource).toBe('remote');
    const prod = eas.build.production;
    expect(prod.android.buildType).toBe('app-bundle');
    expect(prod.autoIncrement).toBe(true);
    expect(Object.keys(prod.env).sort()).toEqual(['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_URL']);
    expect(eas.build.preview.autoIncrement).toBe(true);
  });

  it('versionCode tohumu 5: uzak sayaç buradan başlarsa ilk mağaza derlemesi 6', () => {
    expect(app.android.versionCode).toBe(5);
  });

  it('submit: servis hesabı anahtarı projede değil (EAS sunucusunda)', () => {
    const android = eas.submit.production.android;
    expect(android.serviceAccountKeyPath).toBeUndefined();
    expect(JSON.stringify(eas.submit)).not.toMatch(/\.json/);
  });

  it('sürüm 0.12.0, package.json ile aynı', () => {
    expect(app.version).toBe('0.12.0');
    expect(pkg.version).toBe(app.version);
  });
});
