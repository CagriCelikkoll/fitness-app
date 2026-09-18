import { Tabs } from 'expo-router';
import {
  Dumbbell,
  ListChecks,
  Activity,
  TrendingUp,
  Settings as SettingsIcon,
} from 'lucide-react-native';

import { COLORS } from '@/theme';

const TAB_ICON_SIZE = 24;

export default function TabsLayout() {
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
