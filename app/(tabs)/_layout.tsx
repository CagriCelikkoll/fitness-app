import { Tabs } from 'expo-router';
import {
  Building2,
  Dumbbell,
  ListChecks,
  Activity,
  TrendingUp,
  Settings as SettingsIcon,
} from 'lucide-react-native';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors, useGymTones } from '@/hooks/useTheme';


const TAB_ICON_SIZE = 24;

export default function TabsLayout() {
  const COLORS = useColors();
  // Salon sekmesi (v3.6c): bayrak açık ve bir salona üyeyse; salon renginde.
  // Bayrak kapalıyken useGymMembership istek atmaz, sekme gizli kalır.
  const { primary } = useGymMembership();
  const gymTones = useGymTones(primary?.primaryColor);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarStyle: {
          backgroundColor: COLORS.bg,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 10, letterSpacing: 0.4 },
        headerStyle: { backgroundColor: COLORS.bg },
        headerShadowVisible: false,
        headerTintColor: COLORS.text,
        headerTitleStyle: { fontWeight: '600' },
        sceneStyle: { backgroundColor: COLORS.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ana Sayfa',
          tabBarIcon: ({ color }) => (
            <Activity color={color} size={TAB_ICON_SIZE} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="gym"
        options={{
          title: 'Salon',
          href: primary ? undefined : null,
          tabBarActiveTintColor: gymTones.ink,
          tabBarIcon: ({ color }) => (
            <Building2 color={color} size={TAB_ICON_SIZE} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: 'Antrenman',
          tabBarIcon: ({ color }) => (
            <Dumbbell color={color} size={TAB_ICON_SIZE} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: 'Egzersizler',
          tabBarIcon: ({ color }) => (
            <ListChecks color={color} size={TAB_ICON_SIZE} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'İlerleme',
          tabBarIcon: ({ color }) => (
            <TrendingUp color={color} size={TAB_ICON_SIZE} strokeWidth={1.75} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Ayarlar',
          tabBarIcon: ({ color }) => (
            <SettingsIcon
              color={color}
              size={TAB_ICON_SIZE}
              strokeWidth={1.75}
            />
          ),
        }}
      />
    </Tabs>
  );
}
