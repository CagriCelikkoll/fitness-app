/**
 * v4.0a Bölüm 5: havada duran alt menü, sekme adları, Profil.
 * - Menü geometrisi ve sekme ekranlarının alt boşluğu
 * - 6 sekmede etiketlerin sığması (rapor: 360 dp'de sığmıyor)
 * - Profil satırları: eski Ayarlar sekmesinin hiçbir bölümü kaybolmadı
 * - Avatar harfi, dinlenme saati, eşitleme satırı
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TAB_BAR, floatingTabBarLayout, tabLabelsFit } from '@/lib/safeArea';
import {
  SETTINGS_GROUPS,
  avatarInitial,
  isSettingsGroup,
  profileSyncLine,
  restClock,
} from '@/lib/settingsGroups';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

describe('havada duran alt menü', () => {
  it('alttan gezinme çubuğu + 22; içerik menünün üstünde biter; klavyede 0', () => {
    expect(TAB_BAR).toEqual({ side: 16, gap: 22, height: 64, radius: 22 });
    expect(floatingTabBarLayout(48, false)).toEqual({ bottom: 70, scenePadding: 70 + 64 + 8 });
    expect(floatingTabBarLayout(0, false).bottom).toBe(22);
    expect(floatingTabBarLayout(Number.NaN, false).bottom).toBe(22);
    expect(floatingTabBarLayout(48, true).scenePadding).toBe(0);
  });

  it('5 sekme 360 dp’de sığıyor, 6 sekme sığmıyor (rapor)', () => {
    const five = ['Bugün', 'Rutinler', 'Hareketler', 'İlerleme', 'Profil'];
    expect(tabLabelsFit(360, five)).toBe(true);
    expect(tabLabelsFit(360, ['Bugün', 'Salon', ...five.slice(1)])).toBe(false);
  });

  it('sekme adları ve sırası; özel menü bağlı', () => {
    const src = read('app/(tabs)/_layout.tsx');
    const titles = [...src.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
    expect(titles).toEqual(['Bugün', 'Salon', 'Rutinler', 'Hareketler', 'İlerleme', 'Profil']);
    expect(src).toContain('tabBar={(props) => <FloatingTabBar {...props} />}');
    expect(src).toContain('paddingBottom: scenePadding');
  });
});

describe('Profil', () => {
  it('ayar satırları spec sırasıyla (+ Vücut bilgileri)', () => {
    expect(SETTINGS_GROUPS.map((g) => g.title)).toEqual([
      'Görünüm',
      'Vücut bilgileri',
      'Birimler ve dinlenme',
      'Bildirimler',
      'Yedekleme ve dışa aktarma',
      'Gizlilik ve hesap',
      'Hakkında',
    ]);
    expect(isSettingsGroup('account')).toBe(true);
    expect(isSettingsGroup('nope')).toBe(false);
    expect(isSettingsGroup(undefined)).toBe(false);
  });

  it('eski Ayarlar sekmesinin bütün bölümleri bir alt sayfada', () => {
    const sections = read('src/components/settings/SettingsSections.tsx');
    const exported = [...sections.matchAll(/^export function (\w+Section)\(/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(
      [
        'AboutSection',
        'AccountSection',
        'AppearanceSection',
        'DangerSection',
        'DataSection',
        'PrivacySection',
        'ProfileSection',
        'UnfinishedSessionsSection',
        'UnitsSection',
        'WorkoutSection',
      ].sort()
    );
    const page = read('app/settings/[group].tsx');
    for (const name of exported) expect(page).toContain(`<${name}`);
    // dinlenme bölümü iki parça: antrenman ve bildirimler
    expect(page).toContain('part="training"');
    expect(page).toContain('part="notifications"');
    // her satırın bir sayfası var
    for (const g of SETTINGS_GROUPS) expect(page).toContain(`group === '${g.key}'`);
  });

  it('bütün ayar anahtarları taşındı (ses, titreşim, bildirim, salon bildirimleri, öneriler, hedef, tema)', () => {
    const sections = read('src/components/settings/SettingsSections.tsx');
    for (const label of [
      'Varsayılan dinlenme süresi',
      'Haftalık hedef (gün)',
      'Dinlenme bitiminde ses',
      'Dinlenme bitiminde titreşim',
      'Dinlenme bildirimi',
      'Salon duyuruları',
      'Ders iptalleri ve değişiklikleri',
      'İlerleme önerileri',
      'Salon rengini kullan',
      'Hocalarım',
      'Hesabımı sil',
      'Çıkış yap',
      'Tanıtımı tekrar göster',
    ]) {
      expect(sections).toContain(label);
    }
  });

  it('avatar harfi Türkçe büyük; ad yoksa yok', () => {
    expect(avatarInitial('çağrı')).toBe('Ç');
    expect(avatarInitial('ilker')).toBe('İ');
    expect(avatarInitial('  Ada ')).toBe('A');
    expect(avatarInitial(null)).toBeNull();
    expect(avatarInitial('  ')).toBeNull();
  });

  it('dinlenme saati ve eşitleme satırı', () => {
    expect(restClock(90)).toBe('1:30');
    expect(restClock(120)).toBe('2:00');
    expect(restClock(5)).toBe('0:05');
    expect(profileSyncLine(false, { kind: 'status', text: 'x', tone: 'ok' })).toEqual({
      text: 'Hesapsız — veriler bu telefonda',
      tone: 'muted',
    });
    expect(profileSyncLine(true, { kind: 'status', text: 'Eşitlendi · 2 dk önce', tone: 'ok' }).text).toBe(
      'Yedeklendi · 2 dk önce'
    );
    expect(profileSyncLine(true, { kind: 'status', text: '3 değişiklik bekliyor', tone: 'muted' }).text).toBe(
      '3 değişiklik bekliyor'
    );
    expect(profileSyncLine(true, { kind: 'confirm' }).tone).toBe('danger');
  });
});
