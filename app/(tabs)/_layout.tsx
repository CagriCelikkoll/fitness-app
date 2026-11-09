import { Tabs } from 'expo-router';
import {
  Building2,
  Dumbbell,
  House,
  ListChecks,
  TrendingUp,
  UserRound,
} from 'lucide-react-native';
import { FloatingTabBar } from '@/components/FloatingTabBar';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useFloatingTabBarLayout } from '@/hooks/useSafeBottom';
import { useColors, useGymTones } from '@/hooks/useTheme';
import { TAB_TITLES, visibleTabs } from '@/lib/tabRoutes';
import { FONT_FAMILIES } from '@/lib/typography';

const ICON = { size: 22, strokeWidth: 1.8 } as const;

/**
 * Sekmeler (v4.0a Bölüm 5, ek): üyede Bugün · Salon · Rutinler · İlerleme ·
 * Profil; üye olmayanda Salon yerine Hareketler (`src/lib/tabRoutes.ts`).
 * Rota adları değişmedi (index, gym, workout, exercises, progress, settings);
 * derin bağlantılar ve `router.push`'lar aynı. Menü havada (`FloatingTabBar`);
 * ekran içeriği menünün üstünde biter.
 */
export default function TabsLayout() {
  const COLORS = useColors();
  // Salon sekmesi (v3.6c): bir salona üyeyse; salon renginde.
  const { primary } = useGymMembership();
  const gymTones = useGymTones(primary?.primaryColor);
  const { scenePadding } = useFloatingTabBarLayout();
  const tabs = visibleTabs(primary != null);
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.muted,
        headerStyle: { backgroundColor: COLORS.bg },
        headerShadowVisible: false,
        headerTintColor: COLORS.text,
        headerTitleStyle: { fontFamily: FONT_FAMILIES.semibold },
        sceneStyle: { backgroundColor: COLORS.bg, paddingBottom: scenePadding },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: TAB_TITLES.index,
          // v4.0a: başlık ekranın içinde ("BUGÜN", tarih, seri)
          headerShown: false,
          tabBarIcon: ({ color }) => <House color={color} {...ICON} />,
        }}
      />
      <Tabs.Screen
        name="gym"
        options={{
          title: TAB_TITLES.gym,
          href: tabs.includes('gym') ? undefined : null,
          tabBarActiveTintColor: gymTones.ink,
          tabBarIcon: ({ color }) => <Building2 color={color} {...ICON} />,
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: TAB_TITLES.workout,
          // v4.0b: başlık ekranın içinde ("RUTİNLER" + yeni rutin)
          headerShown: false,
          tabBarIcon: ({ color }) => <Dumbbell color={color} {...ICON} />,
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: TAB_TITLES.exercises,
          href: tabs.includes('exercises') ? undefined : null,
          tabBarIcon: ({ color }) => <ListChecks color={color} {...ICON} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: TAB_TITLES.progress,
          // v4.0a: başlık ekranın içinde ("İLERLEME" + Hafta / Ay / Yıl)
          headerShown: false,
          tabBarIcon: ({ color }) => <TrendingUp color={color} {...ICON} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: TAB_TITLES.settings,
          // v4.0a: avatar, ad ve eşitleme durumu ekranın içinde
          headerShown: false,
          tabBarIcon: ({ color }) => <UserRound color={color} {...ICON} />,
        }}
      />
    </Tabs>
  );
}
