/**
 * Programı ata (v3.6b, hoca / yönetici). Programın yazarının bu salondaki
 * aktif öğrencilerinden çoklu seçim; zaten atanmış olanlar işaretli ve
 * seçilemez (kaldırmak program ayrıntısında). Sunucu yalnızca aktif
 * öğrenciye atamayı kabul ediyor.
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, GraduationCap, UserPlus } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { assignProgram, canManageProgram } from '@/lib/programs';
import { getSupabase } from '@/lib/supabase';
import { sortByName, studentLabel } from '@/lib/trainers';
import { Card, EmptyState, PrimaryButton } from '@/components/ui';

export default function AssignProgramScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { memberships } = useGymMembership();
  const { userId, programs, assignments, refresh } = usePrograms();
  const { links, loaded, refresh: refreshLinks } = useTrainerLinks();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshLinks();
      void refresh();
    }, [refreshLinks, refresh])
  );

  const program = programs.find((p) => p.id === id) ?? null;
  if (!program || !canManageProgram(program, userId, memberships) || program.archivedAt) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Ata' }} />
        <Text className="text-muted text-base text-center">Bu program atanamıyor.</Text>
      </View>
    );
  }

  const students = sortByName(
    links.filter((l) => l.gymId === program.gymId && l.trainerId === program.authorId && l.status === 'active'),
    (l) => l.studentName
  );
  const already = new Set(assignments.filter((a) => a.programId === program.id).map((a) => a.studentId));

  const toggle = (studentId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });

  const save = async () => {
    if (saving || selected.size === 0) return;
    setSaving(true);
    const result = await assignProgram(getSupabase(), program.id, [...selected]);
    setSaving(false);
    if (!result.ok) {
      Alert.alert('Atanamadı', result.error.message);
      void refreshLinks();
      return;
    }
    await refresh();
    router.back();
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Ata' }} />
      <ScrollView contentContainerClassName="px-5 pt-4 pb-32 gap-4">
        <Text className="text-muted text-sm leading-5 px-1">
          "{program.name}" programını seçtiğin öğrenciler görür ve rutinlerine ekleyebilir. Bildirim gider.
        </Text>
        {loaded && students.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="Aktif öğrenci yok"
            description="Program yalnızca izin vermiş öğrencilere atanabilir. Öğrencilerim'den istek gönder."
            className="mt-6"
          />
        ) : (
          <Card flush className="px-4">
            {students.map((l, i) => {
              const done = already.has(l.studentId);
              const on = done || selected.has(l.studentId);
              return (
                <Pressable
                  key={l.id}
                  onPress={() => !done && toggle(l.studentId)}
                  disabled={done}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: done }}
                  className={`min-h-[52px] flex-row items-center py-3 active:opacity-70 ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <View className="flex-1">
                    <Text className={`text-base font-semibold ${l.studentName ? 'text-fg' : 'text-muted'}`} numberOfLines={1}>
                      {studentLabel(l.studentName)}
                    </Text>
                    {done && <Text className="text-muted text-xs mt-0.5">Atanmış</Text>}
                  </View>
                  <View
                    className={`w-7 h-7 rounded-full items-center justify-center ${
                      on ? (done ? 'bg-bg-elevated' : 'bg-accent') : 'border-2 border-border'
                    }`}
                  >
                    {on && <Check color={done ? COLORS.muted : COLORS.accentFg} size={15} strokeWidth={3} />}
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}
      </ScrollView>
      <View className="absolute left-5 right-5 bottom-6">
        <PrimaryButton
          label={saving ? 'Atanıyor...' : selected.size > 0 ? `${selected.size} öğrenciye ata` : 'Öğrenci seç'}
          icon={UserPlus}
          loading={saving}
          disabled={selected.size === 0 || saving}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}
