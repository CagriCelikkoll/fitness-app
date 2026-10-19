/**
 * Öğrencilerine ata (v3.6b, hoca / yönetici): programdan öğrenciye.
 * Programın yazarının bu salondaki aktif öğrencilerinden çoklu seçim;
 * zaten atanmış olanlar işaretli ve seçilemez (kaldırmak program
 * ayrıntısında). Sunucu yalnızca aktif öğrenciye atamayı kabul ediyor.
 *
 * v3.6e: yeni program kaydedilince buraya gelinir (`after=save`, "Şimdi
 * değil" ile atlanır); öğrenciden gelindiyse (`student`) o seçili gelir.
 * Atayınca onay: "Full Body, Ayşe'ye atandı. Ayşe'ye bildirim gitti."
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, GraduationCap, UserPlus } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { assignProgram, assignedMessage, canManageProgram } from '@/lib/programs';
import { getSupabase } from '@/lib/supabase';
import { sortByName, studentLabel } from '@/lib/trainers';
import { Card, EmptyState, PrimaryButton, SecondaryButton } from '@/components/ui';

export default function AssignProgramScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { id, after, student } = useLocalSearchParams<{ id: string; after?: string; student?: string }>();
  const fromSave = after === 'save';
  const { memberships } = useGymMembership();
  const { userId, programs, assignments, refresh } = usePrograms();
  const { links, loaded, refresh: refreshLinks } = useTrainerLinks();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(student ? [student] : []));
  const [saving, setSaving] = useState(false);
  const program = programs.find((p) => p.id === id) ?? null;
  const already = new Set(assignments.filter((a) => a.programId === id).map((a) => a.studentId));
  const alreadyKey = [...already].sort().join(',');

  // Zaten atanmış öğrenci seçili kalmasın (öğrenciden gelindiyse)
  useEffect(() => {
    if (!alreadyKey) return;
    const done = new Set(alreadyKey.split(','));
    setSelected((prev) => (prev.size > 0 && [...prev].some((s) => done.has(s)) ? new Set([...prev].filter((s) => !done.has(s))) : prev));
  }, [alreadyKey]);

  const openProgram = () => router.replace({ pathname: '/programs/[id]', params: { id } });

  useFocusEffect(
    useCallback(() => {
      void refreshLinks();
      void refresh();
    }, [refreshLinks, refresh])
  );

  if (!program || !canManageProgram(program, userId, memberships) || program.archivedAt) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Text className="text-muted text-base text-center">Bu program atanamıyor.</Text>
      </View>
    );
  }

  const students = sortByName(
    links.filter((l) => l.gymId === program.gymId && l.trainerId === program.authorId && l.status === 'active'),
    (l) => l.studentName
  );
  const canAddStudent = program.authorId === userId;

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
    const names = students.filter((l) => selected.has(l.studentId)).map((l) => l.studentName);
    if (fromSave) openProgram();
    else router.back();
    Alert.alert('Atandı', assignedMessage(program.name, names));
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerRight: fromSave
            ? () => (
                <Pressable onPress={openProgram} hitSlop={12} className="mr-2">
                  <Text className="text-muted font-semibold">Şimdi değil</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <ScrollView contentContainerClassName="px-5 pt-4 pb-32 gap-4">
        {fromSave && <Text className="text-fg text-base font-semibold px-1">Program kaydedildi.</Text>}
        <Text className="text-muted text-sm leading-5 px-1">
          "{program.name}" programını seçtiğin öğrenciler görür ve rutinlerine ekleyebilir. Bildirim gider.
        </Text>
        {loaded && students.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="Henüz öğrencin yok"
            description="Program yalnızca izin vermiş öğrencilere atanabilir. Önce bir üyeyi öğrencin olarak ekle."
            className="mt-6"
            action={
              canAddStudent ? (
                <SecondaryButton
                  label="Önce öğrenci ekle"
                  icon={UserPlus}
                  onPress={() => router.push({ pathname: '/trainer/add', params: { gymId: program.gymId } })}
                />
              ) : undefined
            }
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
