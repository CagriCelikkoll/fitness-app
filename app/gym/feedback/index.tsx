/**
 * Geri bildirimler (v3.6d, yalnızca yönetici). Salon paneli → "Geri
 * bildirimler". Özet, durum ve kategori filtreleri, en yeni üstte. Satır:
 * kategori, metnin başı, tarih, yazar adı ya da "Anonim üye", fotoğraf
 * önizlemesi. Hocalar göremez (sunucu yalnızca yöneticiye döndürüyor).
 */

import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { MessageSquareText } from 'lucide-react-native';

import { useGymFeedback } from '@/hooks/useFeedback';
import { useColors } from '@/hooks/useTheme';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  authorLabel,
  categoryLabel,
  excerpt,
  feedbackSummary,
  filterFeedback,
  summaryText,
  type FeedbackCategory,
  type FeedbackStatus,
} from '@/lib/feedback';
import { formatAgo } from '@/lib/format';
import { FeedbackStatusBadge } from '@/components/FeedbackStatusBadge';
import { Card, Chip, EmptyState, ListRow } from '@/components/ui';

export default function GymFeedbackScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { list, photos, allowed, loaded, loading, error, refresh } = useGymFeedback(gymId ?? null);
  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (!allowed || !gymId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Geri bildirimler' }} />
        <Text className="text-muted text-base text-center">Geri bildirimler yalnızca salon yöneticisine açık.</Text>
      </View>
    );
  }

  const nowMs = Date.now();
  const shown = filterFeedback(list, { status, category });

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
      <Stack.Screen options={{ title: 'Geri bildirimler' }} />
      {loaded && <Text className="text-muted text-sm px-1">{summaryText(feedbackSummary(list, nowMs))}</Text>}
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

      <View className="flex-row flex-wrap gap-2">
        <Chip label="Tümü" size="sm" active={status == null} onPress={() => setStatus(null)} />
        {FEEDBACK_STATUSES.map((s) => (
          <Chip key={s.key} label={s.label} size="sm" active={status === s.key} onPress={() => setStatus(s.key)} />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {FEEDBACK_CATEGORIES.map((c) => (
          <Chip
            key={c.key}
            label={c.label}
            size="sm"
            active={category === c.key}
            onPress={() => setCategory(category === c.key ? null : c.key)}
          />
        ))}
      </View>

      {loaded && shown.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title={list.length === 0 ? 'Henüz geri bildirim yok' : 'Bu filtrede kayıt yok'}
          description={list.length === 0 ? 'Üyeler Salon sekmesindeki "Öneri / Şikâyet" ile yazabilir.' : undefined}
          className="mt-6"
        />
      ) : (
        <Card flush className="px-4">
          {shown.map((f, i) => (
            <ListRow
              key={f.id}
              divider={i > 0}
              chevron
              onPress={() => router.push({ pathname: '/gym/feedback/[id]', params: { id: f.id, gymId } })}
              right={
                f.photoPath && photos[f.photoPath] ? (
                  <Image source={{ uri: photos[f.photoPath] }} style={{ width: 44, height: 44, borderRadius: 8 }} contentFit="cover" />
                ) : undefined
              }
            >
              <View className="flex-row items-center gap-2 mb-1">
                <FeedbackStatusBadge status={f.status} />
                <Text className="text-muted text-xs">{categoryLabel(f.category)}</Text>
              </View>
              <Text className="text-fg text-sm" numberOfLines={2}>
                {excerpt(f.body)}
              </Text>
              <Text className="text-muted text-xs mt-1">
                {authorLabel(f)} · {formatAgo(f.createdAt, nowMs)}
              </Text>
            </ListRow>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
