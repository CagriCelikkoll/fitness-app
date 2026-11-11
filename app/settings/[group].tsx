/**
 * Profil → ayar grubu (v4.0a Bölüm 5). Eski Ayarlar sekmesinin bölümleri
 * aynen (`src/components/settings/SettingsSections.tsx`); hangi satırın
 * neyi açtığı `src/lib/settingsGroups.ts`.
 */

import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';

import {
  AboutSection,
  AccountSection,
  AppearanceSection,
  DangerSection,
  DataSection,
  PrivacySection,
  ProfileSection,
  UnfinishedSessionsSection,
  UnitsSection,
  WorkoutSection,
} from '@/components/settings/SettingsSections';
import { EmptyState } from '@/components/ui';
import { appSettings } from '@/db/schema';
import { useDb } from '@/hooks/useDb';
import { useColors } from '@/hooks/useTheme';
import { isSettingsGroup, settingsGroupTitle } from '@/lib/settingsGroups';

export default function SettingsGroupScreen() {
  const COLORS = useColors();
  const db = useDb();
  const { group } = useLocalSearchParams<{ group: string }>();
  const { data: settingsRows, updatedAt } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1)
  );
  // Geri yükleme ayar satırını da değiştiriyor; formlar kayıtlı değerlerden
  // kurulduğu için yeniden mount edilsin (eski Ayarlar sekmesindeki gibi)
  const [formEpoch, setFormEpoch] = useState(0);

  if (!isSettingsGroup(group)) {
    return (
      <View className="flex-1 bg-bg">
        <Stack.Screen options={{ title: 'Ayarlar' }} />
        <EmptyState title="Bu sayfa bulunamadı" className="py-16" />
      </View>
    );
  }

  const title = settingsGroupTitle(group);

  // Ayarlar gelmeden form bölümleri çizilmesin (kayıtlı değerlerden kuruluyor)
  if (!updatedAt) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <Stack.Screen options={{ title }} />
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const settings = settingsRows?.[0];
  const formKey = `${settings?.id ?? 'new'}-${formEpoch}`;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pt-4 gap-7 pb-12">
      <Stack.Screen options={{ title }} />
      {group === 'appearance' && <AppearanceSection />}
      {group === 'body' && <ProfileSection key={`profile-${formKey}`} settings={settings} />}
      {group === 'training' && (
        <>
          <UnitsSection settings={settings} />
          <WorkoutSection key={`workout-${formKey}`} settings={settings} part="training" />
        </>
      )}
      {group === 'notifications' && <WorkoutSection settings={settings} part="notifications" />}
      {group === 'data' && (
        <>
          <DataSection onDataReplaced={() => setFormEpoch((n) => n + 1)} />
          <UnfinishedSessionsSection />
        </>
      )}
      {group === 'account' && (
        <>
          <AccountSection />
          <PrivacySection />
          <DangerSection />
        </>
      )}
      {group === 'about' && <AboutSection />}
    </ScrollView>
  );
}
