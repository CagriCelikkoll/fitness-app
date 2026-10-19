/**
 * Öğrenci ekle (v3.6a, hoca / yönetici). Salon üyeleri arasında ada göre
 * arama → "İstek gönder". İstek gönderilmiş ya da zaten öğrenci olan kişi
 * durumuyla görünür. Öğrenci izin verene kadar hoca hiçbir şey görmez.
 */

import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Search, Users } from 'lucide-react-native';

import { useGymMembers } from '@/hooks/useGymMembers';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { roleLabel } from '@/lib/auth';
import { canViewMembers, matchesSearch, sortMembers, type GymMember } from '@/lib/gymAdmin';
import { getSupabase } from '@/lib/supabase';
import { candidateState, requestStudent, studentLabel, type CandidateState } from '@/lib/trainers';
import { Card, EmptyState, ListRow } from '@/components/ui';

export default function AddStudentScreen() {
  const COLORS = useColors();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships } = useGymMembership();
  const { members, loaded, loading, error, refresh } = useGymMembers(gymId ?? null);
  const trainer = useTrainerLinks();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void trainer.refresh();
    }, [refresh, trainer.refresh])
  );

  if (!gymId || !canViewMembers(gymId, memberships) || !trainer.userId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Öğrenci ekle' }} />
        <Text className="text-muted text-base text-center">Öğrenci eklemek salonun hocalarına açık.</Text>
      </View>
    );
  }

  const myId = trainer.userId;
  const gymLinks = trainer.links.filter((l) => l.gymId === gymId);
  const list = sortMembers(members).filter((m) => m.userId !== myId && matchesSearch(m, query));

  const send = async (member: GymMember) => {
    setBusyId(member.userId);
    setSendError(null);
    const result = await requestStudent(getSupabase(), gymId, member.userId);
    if (!result.ok) setSendError(result.error.message);
    await trainer.refresh();
    setBusyId(null);
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Öğrenci ekle' }} />
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
                className="flex-1 text-fg text-base px-2 h-11"
              />
            </View>
            <Text className="text-muted text-xs leading-5">
              İstek gönderdiğin üye izin verirse öğrencin olur. Ağırlıklarını ve vücut ölçülerini görmezsin.
            </Text>
            {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}
            {sendError != null && <Text className="text-danger text-sm leading-5">{sendError}</Text>}
          </View>
        }
        ListEmptyComponent={
          loaded && !loading ? (
            <EmptyState
              icon={Users}
              title="Kimse yok"
              description={query ? 'Aramayı değiştir.' : 'Salonda senden başka üye yok.'}
            />
          ) : null
        }
        renderItem={({ item, index }) => (
          <Card flush className={`px-4 ${index === 0 ? '' : 'mt-2'}`}>
            <CandidateRow
              member={item}
              state={candidateState(item.userId, myId, gymLinks)}
              busy={busyId === item.userId}
              onSend={() => void send(item)}
            />
          </Card>
        )}
      />
    </View>
  );
}

const STATE_LABEL: Record<Exclude<CandidateState, 'self' | 'available'>, string> = {
  pending: 'İstek gönderildi',
  active: 'Öğrencin',
};

function CandidateRow({
  member: m,
  state,
  busy,
  onSend,
}: {
  member: GymMember;
  state: CandidateState;
  busy: boolean;
  onSend: () => void;
}) {
  return (
    <ListRow
      right={
        state === 'available' ? (
          <Pressable
            onPress={onSend}
            disabled={busy}
            accessibilityRole="button"
            hitSlop={8}
            className={`px-3 py-1.5 rounded-full ${busy ? 'bg-bg-elevated' : 'bg-accent'} active:opacity-70`}
          >
            <Text className={`text-xs font-semibold ${busy ? 'text-muted' : 'text-accent-fg'}`}>
              {busy ? 'Gönderiliyor…' : 'İstek gönder'}
            </Text>
          </Pressable>
        ) : state !== 'self' ? (
          <Text className={`text-xs font-semibold ${state === 'active' ? 'text-accent' : 'text-muted'}`}>
            {STATE_LABEL[state]}
          </Text>
        ) : null
      }
    >
      <Text className={`text-base font-semibold ${m.name ? 'text-fg' : 'text-muted'}`} numberOfLines={1}>
        {studentLabel(m.name)}
      </Text>
      <Text className="text-muted text-xs mt-0.5">{roleLabel(m.role)}</Text>
    </ListRow>
  );
}
