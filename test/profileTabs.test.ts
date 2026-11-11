/**
 * v4.0a Bölüm 5: havada duran alt menü, sekme adları, Profil.
 * - Menü geometrisi ve sekme ekranlarının alt boşluğu
 * - Üye / üye olmayan için sekme listesi; etiketler 360 dp'de sığıyor
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
import { TAB_TITLES, visibleTabs } from '@/lib/tabRoutes';

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

  const titles = (member: boolean) => visibleTabs(member).map((r) => TAB_TITLES[r]);

  it('üye: Salon var, Hareketler yok; üye olmayan: tersi', () => {
    expect(titles(true)).toEqual(['Bugün', 'Salon', 'Rutinler', 'İlerleme', 'Profil']);
    expect(titles(false)).toEqual(['Bugün', 'Rutinler', 'Hareketler', 'İlerleme', 'Profil']);
  });

  it('iki listede de 12 px etiketler 360 dp’de sığıyor; 6 sekme sığmazdı', () => {
    expect(tabLabelsFit(360, titles(true))).toBe(true);
    expect(tabLabelsFit(360, titles(false))).toBe(true);
    expect(tabLabelsFit(360, ['Salon', ...titles(false)])).toBe(false);
  });

  it('etiket küçültme yok (12 px altı yazı olmaz)', () => {
    const bar = read('src/components/FloatingTabBar.tsx');
    expect(bar).not.toContain('adjustsFontSizeToFit');
    expect(bar).not.toContain('minimumFontScale');
    expect(bar).toContain('fontSize: 12');
  });

  it('menü bağlı; gizleme tek listeden', () => {
    const src = read('app/(tabs)/_layout.tsx');
    expect(src).toContain('tabBar={(props) => <FloatingTabBar {...props} />}');
    expect(src).toContain('paddingBottom: scenePadding');
    expect(src).toContain("href: tabs.includes('gym') ? undefined : null");
    expect(src).toContain("href: tabs.includes('exercises') ? undefined : null");
  });

  it('üye hareket listesine Rutinler ekranından ulaşıyor (boş listede de)', () => {
    const src = read('app/(tabs)/workout.tsx');
    expect(src).toContain('<Link href="/exercise" asChild>');
    // tek liste: giriş satırları rutin yokken de (`ListEmptyComponent`) üstte
    expect(src.match(/<ExercisesEntry \/>/g)).toHaveLength(1);
    expect(src.indexOf('<ExercisesEntry />')).toBeGreaterThan(src.indexOf('ListHeaderComponent'));
    expect(src).toContain('ListEmptyComponent');
    expect(read('app/exercise/index.tsx')).toContain("from '../(tabs)/exercises'");
    expect(read('app/_layout.tsx')).toContain('name="exercise/index"');
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
