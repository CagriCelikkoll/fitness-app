/**
 * Üyeler (v3.2d). Ayarlar → Hesap ve salon → "Üyeler". Hoca ve yönetici
 * görür; yalnızca yönetici değiştirir (üyeye dokununca ayrıntı). Ada göre
 * arama, filtre çipleri, sayılar. Adlar yalnızca hoca / yöneticiye açık
 * (sunucu RLS); adı olmayan "Adı girilmemiş üye".
 */

import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Search, Users } from 'lucide-react-native';

import { useGymMembers } from '@/hooks/useGymMembers';
import { useGymMembership } from '@/hooks/useGymMembership';
import { roleLabel } from '@/lib/auth';
import {
  MEMBER_FILTERS,
  canManageGym,
  canViewMembers,
  filterMembers,
  formatEndDate,
  memberCountsText,
  membershipDaysLeft,
  type GymMember,
  type MemberFilter,
} from '@/lib/gymAdmin';
import { UNNAMED } from '@/lib/classRsvps';
import { gymNow } from '@/lib/classes';
import { Card, Chip, EmptyState, ListRow } from '@/components/ui';
import { COLORS } from '@/theme';

export default function MembersScreen() {
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { userId, memberships } = useGymMembership();
  const { members, loaded, loading, error, refresh } = useGymMembers(gymId ?? null);
  const [filter, setFilter] = useState<MemberFilter>('all');
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (!gymId || !canViewMembers(gymId, memberships)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Üyeler' }} />
        <Text className="text-muted text-base text-center">Üye listesini salonun hocaları ve yöneticisi görür.</Text>
      </View>
    );
  }

  const nowMs = Date.now();
  const isAdmin = canManageGym(gymId, memberships);
  const list = filterMembers(members, filter, query, nowMs);

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Üyeler' }} />
      <FlatList
        data={list}
        keyExtractor={(m) => m.userId}
        contentContainerClassName="px-5 pt-4 pb-12"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading && loaded}
            onRefresh={() => void refresh()}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
        ListHeaderComponent={
          <View className="gap-3 mb-3">
            <View className="flex-row items-center bg-bg-elevated rounded-xl px-3">
              <Search color={COLORS.muted} size={18} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Ada göre ara"
                placeholderTextColor={COLORS.muted}
                autoCorrect={false}
                className="flex-1 text-white text-base px-2 h-11"
              />
            </View>
            <FlatList
              horizontal
              data={MEMBER_FILTERS}
              keyExtractor={(f) => f.key}
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2"
              renderItem={({ item }) => (
                <Chip label={item.label} size="sm" active={filter === item.key} onPress={() => setFilter(item.key)} />
              )}
            />
            {loaded && <Text className="text-muted text-xs">{memberCountsText(members)}</Text>}
            {!isAdmin && <Text className="text-muted text-xs leading-5">Hocalar listeyi yalnızca görür.</Text>}
            {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}
          </View>
        }
        ListEmptyComponent={
          loaded && !loading ? (
            <EmptyState
              icon={Users}
              title="Kimse yok"
              description={query || filter !== 'all' ? 'Aramayı ya da filtreyi değiştir.' : 'Salona henüz kimse katılmadı.'}
            />
          ) : null
        }
        renderItem={({ item, index }) => (
          <Card flush className={`px-4 ${index === 0 ? '' : 'mt-2'}`}>
            <MemberRow
              member={item}
              isMe={item.userId === userId}
              nowMs={nowMs}
              onPress={() => router.push({ pathname: '/gym/member', params: { gymId, userId: item.userId } })}
            />
          </Card>
        )}
      />
    </View>
  );
}

function MemberRow({
  member: m,
  isMe,
  nowMs,
  onPress,
}: {
  member: GymMember;
  isMe: boolean;
  nowMs: number;
  onPress: () => void;
}) {
  const days = membershipDaysLeft(m.membershipEndsOn, nowMs);
  const endTone = days == null ? 'text-muted' : days < 0 ? 'text-danger' : days <= 7 ? 'text-warm' : 'text-muted';
  return (
    <ListRow
      chevron
      onPress={onPress}
      right={
        <View className={`px-2 py-0.5 rounded-full ${m.role === 'member' ? 'bg-bg-elevated' : 'bg-accent/15'}`}>
          <Text className={`text-xs font-semibold ${m.role === 'member' ? 'text-muted' : 'text-accent'}`}>
            {roleLabel(m.role)}
          </Text>
        </View>
      }
    >
      <Text className={`text-base font-semibold ${m.name ? 'text-white' : 'text-muted'}`} numberOfLines={1}>
        {m.name ?? UNNAMED}
        {isMe ? ' (sen)' : ''}
      </Text>
      <Text className="text-muted text-xs mt-0.5">
        {m.joinedAt ? `Katılım: ${formatEndDate(gymNow(Date.parse(m.joinedAt)).date, nowMs)}` : ''}
        {m.membershipEndsOn != null && (
          <Text className={endTone}>
            {' · '}Bitiş: {formatEndDate(m.membershipEndsOn, nowMs)}
            {days != null && days < 0 ? ' (bitti)' : ''}
          </Text>
        )}
      </Text>
    </ListRow>
  );
}
