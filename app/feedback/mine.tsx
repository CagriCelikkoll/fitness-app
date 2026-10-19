/**
 * Gönderdiklerim (v3.6d, üye). Durum rozeti (Yeni / İnceleniyor /
 * Çözüldü), yönetimin yanıtı, fotoğraf. "Sil" onaylı (fotoğraf da silinir).
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { MessageSquareText, Plus } from 'lucide-react-native';

import { useMyFeedback } from '@/hooks/useFeedback';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import { categoryLabel, deleteFeedback, type Feedback } from '@/lib/feedback';
import { formatAgo } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';
import { FeedbackStatusBadge } from '@/components/FeedbackStatusBadge';
import { Card, EmptyState, PrimaryButton } from '@/components/ui';

export default function MyFeedbackScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId?: string }>();
  const { memberships } = useGymMembership();
  const { list, photos, loaded, loading, error, refresh } = useMyFeedback();
  const [busyId, setBusyId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const shown = gymId ? list.filter((f) => f.gymId === gymId) : list;
  const gymName = (id: string) => memberships.find((m) => m.gymId === id)?.gymName ?? null;

  const confirmDelete = (f: Feedback) =>
    Alert.alert('Silinsin mi?', 'Geri bildirim ve fotoğrafı salon yönetiminden de kalkar.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          setBusyId(f.id);
          const result = await deleteFeedback(getSupabase(), f);
          setBusyId(null);
          if (!result.ok) Alert.alert('Silinemedi', result.error.message);
          await refresh();
        },
      },
    ]);

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 pb-12 gap-3"
      refreshControl={
        <RefreshControl
          refreshing={loading && loaded}
          onRefresh={() => void refresh()}
          tintColor={COLORS.accent}
          colors={[COLORS.accent]}
        />
      }
    >
      <Stack.Screen options={{ title: 'Gönderdiklerim' }} />
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}
      {loaded && shown.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title="Henüz geri bildirim göndermedin"
          description="Salonla ilgili öneri, istek ya da şikâyetini yönetime iletebilirsin."
          className="mt-6"
          action={
            <PrimaryButton
              label="Öneri / Şikâyet yaz"
              icon={Plus}
              onPress={() => router.replace({ pathname: '/feedback/new', params: gymId ? { gymId } : {} })}
            />
          }
        />
      ) : (
        shown.map((f) => (
          <Card key={f.id} className="gap-2">
            <View className="flex-row items-center gap-2">
              <FeedbackStatusBadge status={f.status} />
              <Text className="text-muted text-xs flex-1" numberOfLines={1}>
                {[categoryLabel(f.category), memberships.length > 1 ? gymName(f.gymId) : null, formatAgo(f.createdAt, Date.now())]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {f.anonymous && <Text className="text-muted text-xs">İsim gizli</Text>}
            </View>
            <Text className="text-fg text-base leading-6">{f.body}</Text>
            {f.photoPath && photos[f.photoPath] && (
              <Image
                source={{ uri: photos[f.photoPath] }}
                style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 12 }}
                contentFit="cover"
              />
            )}
            {f.reply && (
              <View className="bg-bg-elevated rounded-xl p-3 gap-1">
                <Text className="text-accent text-xs font-semibold">Yönetimin yanıtı</Text>
                <Text className="text-fg text-sm leading-5">{f.reply}</Text>
              </View>
            )}
            <Pressable
              onPress={() => confirmDelete(f)}
              disabled={busyId != null}
              hitSlop={8}
              className="self-end active:opacity-60"
            >
              <Text className={`text-sm ${busyId === f.id ? 'text-muted' : 'text-danger'}`}>Sil</Text>
            </Pressable>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
