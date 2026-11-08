/**
 * Alt menünün sekmeleri (v4.0a ek): her zaman 5 sekme, 12 px etiketler 360 dp
 * telefonda sığsın diye. Salon üyesinde Salon, Hareketler'in yerine geçer;
 * hareket listesi Rutinler ekranının üstünden (`/exercise`) ve egzersiz
 * seçiciden açılır. Rota adları değişmedi.
 */

export type TabRoute = 'index' | 'gym' | 'workout' | 'exercises' | 'progress' | 'settings';

export const TAB_TITLES: Record<TabRoute, string> = {
  index: 'Bugün',
  gym: 'Salon',
  workout: 'Rutinler',
  exercises: 'Hareketler',
  progress: 'İlerleme',
  settings: 'Profil',
};

export function visibleTabs(isGymMember: boolean): readonly TabRoute[] {
  return isGymMember
    ? ['index', 'gym', 'workout', 'progress', 'settings']
    : ['index', 'workout', 'exercises', 'progress', 'settings'];
}
