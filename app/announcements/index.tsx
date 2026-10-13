/**
 * Duyurular (v3.2b). Sabitlenmişler üstte, sonra yeniden eskiye. Aşağı
 * çekince yenilenir; açılınca da. Son açılıştan sonra yazılanlar
 * işaretli (son açılış yalnızca telefonda). İnternetsizken önbellekteki
 * liste ve "çevrimdışı" notu.
 *
 * Hoca / yönetici "Duyuru yaz" görür; kendi duyurusunu (yönetici:
 * hepsini) düzenler. Rol görünüm içindir ve ekran her açılışta
 * üyelikleri sunucudan yeniler; yetkiyi sunucu belirler.
 */

import { useCallback, useRef } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Megaphone, PenSquare, Pin } from 'lucide-react-native';

import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useGymMembership } from '@/hooks/useGymMembership';
import { canManage, isUnread, writableGyms, type Announcement } from '@/lib/announcements';
import { formatAgo } from '@/lib/format';
import { Card, EmptyState, PrimaryButton } from '@/components/ui';
import { COLORS } from '@/theme';

export default function AnnouncementsScreen() {
  const router = useRouter();
  const { available, userId, memberships, refresh: refreshMemberships } = useGymMembership();
  const { items, loaded, loading, offline, error, lastSeenAt, refresh, markSeen } = useAnnouncements();
  // İşaretler bu açılıştaki "önceki son açılışa" göre; ekran açıkken kaybolmasın
  const seenAtOpen = useRef<string | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      if (!available || !userId) return;
      if (seenAtOpen.current === undefined) seenAtOpen.current = lastSeenAt;
      void refreshMemberships();
      void refresh().finally(markSeen);
      return () => {
        seenAtOpen.current = undefined;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [available, userId])
  );

  if (!available || !userId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Duyurular' }} />
        <Text className="text-muted text-base text-center">Duyurular için giriş yapman gerekiyor.</Text>
      </View>
    );
  }

  const gymNames = new Map(memberships.map((m) => [m.gymId, m.gymName]));
  const showGym = memberships.length > 1;
  const canWrite = writableGyms(memberships).length > 0;
  const now = Date.now();

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Duyurular' }} />
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerClassName="px-5 pt-4 pb-12 gap-3"
        refreshControl={
          <RefreshControl
            refreshing={loading && loaded}
            onRefresh={() => void refresh()}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
        ListHeaderComponent={
          <View className="gap-3">
            {canWrite && (
              <PrimaryButton
                label="Duyuru yaz"
                icon={PenSquare}
                onPress={() => router.push('/announcements/edit')}
              />
            )}
            {offline && (
              <Text className="text-muted text-xs leading-5">
                Çevrimdışı · son çekilen liste gösteriliyor
              </Text>
            )}
            {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}
          </View>
        }
        ListEmptyComponent={
          loaded && !loading ? (
            <EmptyState
              icon={Megaphone}
              title="Henüz duyuru yok"
              description="Salonun bir duyuru yazdığında burada görünecek."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <AnnouncementItem
            item={item}
            unread={isUnread(item, seenAtOpen.current === undefined ? lastSeenAt : seenAtOpen.current)}
            gymName={showGym ? (gymNames.get(item.gymId) ?? null) : null}
            nowMs={now}
            onEdit={
              canManage(item, userId, memberships)
                ? () => router.push({ pathname: '/announcements/edit', params: { id: item.id } })
                : undefined
            }
          />
        )}
      />
    </View>
  );
}

function AnnouncementItem({
  item,
  unread,
  gymName,
  nowMs,
  onEdit,
}: {
  item: Announcement;
  unread: boolean;
  gymName: string | null;
  nowMs: number;
  onEdit?: () => void;
}) {
  const edited = Date.parse(item.updatedAt) - Date.parse(item.createdAt) > 60_000;
  return (
    <Card variant={unread ? 'outline' : 'default'} className="gap-2">
      <View className="flex-row items-start gap-2">
        {item.pinned && <Pin color={COLORS.accent} size={16} style={{ marginTop: 3 }} />}
        <Text className="text-white text-base font-semibold flex-1">{item.title}</Text>
        {unread && <View className="w-2 h-2 rounded-full bg-accent mt-2" accessibilityLabel="Okunmadı" />}
      </View>
      <Text className="text-white text-sm leading-5" selectable>
        {item.body}
      </Text>
      <View className="flex-row items-center justify-between">
        <Text className="text-muted text-xs">
          {[gymName, formatAgo(item.createdAt, nowMs), edited ? 'düzenlendi' : null].filter(Boolean).join(' · ')}
        </Text>
        {onEdit && (
          <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button" className="active:opacity-60">
            <Text className="text-accent text-sm font-semibold">Düzenle</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}
