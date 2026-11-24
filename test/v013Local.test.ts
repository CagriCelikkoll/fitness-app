/**
 * 0.13 Bölüm 1: gezinme çubuğu, titreşim, yedekleme kuralları (DNC-05).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { hapticCall } from '@/lib/haptics';
import { DARK_SCREEN_BAR_STYLE, systemBarStyle } from '@/lib/systemBars';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const app = JSON.parse(read('app.json')).expo;
const plugin = (name: string) =>
  (app.plugins as (string | [string, Record<string, unknown>])[]).find((p) => (Array.isArray(p) ? p[0] : p) === name);

describe('gezinme çubuğu', () => {
  it('tuş stili temayı izler; koyu ekranlarda açık tuş', () => {
    expect(systemBarStyle('dark')).toBe('light');
    expect(systemBarStyle('light')).toBe('dark');
    expect(DARK_SCREEN_BAR_STYLE).toBe('light');
  });

  it('kontrast perdesi (beyaz şerit) kapalı, açılış stili koyu zemine göre', () => {
    expect(plugin('expo-navigation-bar')).toEqual(['expo-navigation-bar', { enforceContrast: false, style: 'light' }]);
  });

  it('kök tema çubuğu ayarlıyor; görselli ekranlar DarkSystemBars kullanıyor', () => {
    expect(read('src/hooks/useTheme.tsx')).toContain('<NavigationBar style={systemBarStyle(scheme)} />');
    for (const f of [
      'app/routine/cover/[id].tsx',
      'app/templates/[id].tsx',
      'src/components/OnboardingIntro.tsx',
      'src/components/RecordCelebration.tsx',
    ]) {
      const src = read(f);
      expect(src, f).toContain('<DarkSystemBars />');
      expect(src, f).not.toContain('<StatusBar style="light" />');
    }
  });
});

describe('titreşim', () => {
  it('ayar kapalıysa hiç çağrı yok', () => {
    for (const kind of ['setComplete', 'restDone', 'record'] as const) {
      expect(hapticCall(kind, 'android', false)).toBeNull();
      expect(hapticCall(kind, 'ios', false)).toBeNull();
    }
  });

  it('Android: sistem dokunma titreşimine uyan performHapticFeedback (Vibrator değil)', () => {
    expect(hapticCall('setComplete', 'android', true)).toEqual({ api: 'androidHaptics', type: 'keyboard-tap' });
    expect(hapticCall('restDone', 'android', true)).toEqual({ api: 'androidHaptics', type: 'long-press' });
    // CONFIRM Android 11+; Android 9'da yedek
    expect(hapticCall('record', 'android', true)).toEqual({
      api: 'androidHaptics',
      type: 'confirm',
      fallback: 'long-press',
    });
  });

  it('iOS: hafif / orta / başarı', () => {
    expect(hapticCall('setComplete', 'ios', true)).toEqual({ api: 'impact', style: 'light' });
    expect(hapticCall('restDone', 'ios', true)).toEqual({ api: 'impact', style: 'medium' });
    expect(hapticCall('record', 'ios', true)).toEqual({ api: 'notification', type: 'success' });
  });

  it('web / bilinmeyen platform: yok', () => {
    expect(hapticCall('record', 'web', true)).toBeNull();
  });

  it('ekranlar doğrudan expo-haptics çağırmıyor (tek yer hapticsNative)', () => {
    for (const f of ['app/session/active.tsx', 'src/components/RestTimer.tsx', 'src/components/RecordCelebration.tsx']) {
      expect(read(f), f).not.toContain("from 'expo-haptics'");
    }
    expect(read('app/session/active.tsx')).toContain("haptic('setComplete', vibrate)");
    expect(read('src/components/RestTimer.tsx')).toContain("haptic('restDone', vibrateRef.current)");
    expect(read('src/components/RecordCelebration.tsx')).toContain("haptic('record'");
  });
});

describe('yedekleme kuralları (DNC-05)', () => {
  const req = createRequire(__filename);
  const rules = req(path.join(ROOT, 'plugins/withBackupRules.js')) as {
    EXCLUDES: { domain: string; path: string }[];
    DATA_EXTRACTION_RULES: string;
    FULL_BACKUP_CONTENT: string;
  };

  it('eklenti app.json\'da; secure-store kendi kurallarını yazmıyor', () => {
    expect(app.plugins).toContain('./plugins/withBackupRules');
    expect(plugin('expo-secure-store')).toEqual([
      'expo-secure-store',
      { configureAndroidBackup: false, faceIDPermission: false },
    ]);
  });

  it('güvenli depo ve kv-store (oturum, tercihler) hariç', () => {
    const paths = rules.EXCLUDES.map((e) => `${e.domain}:${e.path}`);
    expect(paths).toContain('sharedpref:SecureStore.xml');
    expect(paths).toContain('file:SQLite/ExpoSQLiteStorage');
    expect(paths).toContain('file:SQLite/ExpoSQLiteStorage-wal');
  });

  it('antrenman veritabanı hariç değil (yalnızca exclude; include yok)', () => {
    for (const xml of [rules.DATA_EXTRACTION_RULES, rules.FULL_BACKUP_CONTENT]) {
      expect(xml).not.toContain('fitness.db');
      expect(xml).not.toContain('<include');
    }
  });

  it('bulut yedeği ve cihaz aktarımı aynı kurallarla; eski Android için de dosya var', () => {
    const x = rules.DATA_EXTRACTION_RULES;
    expect(x).toContain('<cloud-backup>');
    expect(x).toContain('<device-transfer>');
    for (const e of rules.EXCLUDES) {
      const line = `<exclude domain="${e.domain}" path="${e.path}" />`;
      expect(x.split(line).length - 1).toBe(2);
      expect(rules.FULL_BACKUP_CONTENT).toContain(line);
    }
  });
});
