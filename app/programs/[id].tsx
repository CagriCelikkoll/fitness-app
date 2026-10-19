/**
 * Program ayrıntısı (v3.6b): günler, egzersizler (görsel + Türkçe ad),
 * set × tekrar, dinlenme, hoca notu.
 *
 * - "Rutinlerime ekle": her gün bir yerel rutin ("Full Body – A · Duygu
 *   Hoca"); bağ ve sürüm cihazda. Kütüphanede olmayan egzersiz atlanır,
 *   uyarı gösterilir.
 * - Program rutine eklendikten sonra güncellendiyse "Rutinlerimi güncelle"
 *   (onaylı; geçmiş antrenmanlar etkilenmez).
 * - Hoca / yönetici: Düzenle, Ata, atananlar (kaldırma onaylı), Arşivle.
 *   v3.6e: "Öğrencilerine ata" ve atananlar en üstte; hocanın kendi
 *   rutinlerine eklemesi ikincil düğme ("Kendi rutinlerime ekle").
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, ArchiveRestore, ListPlus, Pencil, RefreshCw, UserPlus } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import { useGymMembership } from '@/hooks/useGymMembership';
import {
  addProgramToRoutines,
  applyProgramUpdate,
  keepProgramRoutines,
  usePrograms,
  useRoutineLinks,
} from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import {
  canManageProgram,
  programExerciseIds,
  programUpdates,
  setProgramArchived,
  skippedText,
  unassignProgram,
  visibilityLabel,
  type GymProgram,
  type ProgramPayload,
} from '@/lib/programs';
import { getSupabase } from '@/lib/supabase';
import { studentLabel, trainerTitle } from '@/lib/trainers';
import { ProgramExerciseRow } from '@/components/ProgramExerciseRow';
import { StudentRow } from '@/components/StudentRow';
import { Card, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/ui';

export default function ProgramDetailScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const db = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { memberships } = useGymMembership();
  const { userId, programs, assignments, loaded, loading, offline, error, enabled, refresh } = usePrograms();
  const { links: trainerLinks, refresh: refreshTrainerLinks } = useTrainerLinks();
  const { links } = useRoutineLinks(enabled);
  const [busy, setBusy] = useState<string | null>(null);

  const program = programs.find((p) => p.id === id) ?? null;
  const manage = program != null && canManageProgram(program, userId, memberships);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      if (manage) void refreshTrainerLinks();
    }, [refresh, refreshTrainerLinks, manage])
  );

  const payload = program?.payload ?? null;
  const { byId, loaded: libraryLoaded } = useExerciseLookup(payload ? programExerciseIds(payload) : []);

  if (!program) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Program' }} />
        {!loaded || loading ? (
          <ActivityIndicator color={COLORS.accent} />
        ) : (
          <Text className="text-muted text-base text-center">
            Program bulunamadı. Kaldırılmış ya da artık sana açık olmayabilir.
          </Text>
        )}
      </View>
    );
  }

  const myLinks = links.filter((l) => l.programId === program.id);
  const update = programUpdates(links, [program])[0] ?? null;
  const assigned = manage
    ? assignments
        .filter((a) => a.programId === program.id)
        .map((a) => ({
          assignment: a,
          link: trainerLinks.find(
            (l) => l.gymId === program.gymId && l.studentId === a.studentId && l.trainerId === program.authorId && l.status === 'active'
          ),
        }))
        // Bağı biten öğrencinin ataması ona görünmüyor; burada da gösterme
        .filter((x) => x.link != null)
    : [];

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      console.error('[PROGRAMS] HATA:', e);
      Alert.alert('Yapılamadı', String(e));
    } finally {
      setBusy(null);
    }
  };

  const add = (p: GymProgram & { payload: ProgramPayload }) =>
    run('add', async () => {
      const { count, plan } = await addProgramToRoutines(db, p);
      const warning = skippedText(plan);
      Alert.alert(
        count > 0 ? 'Rutinlerine eklendi' : 'Eklenemedi',
        [count > 0 ? `${count} rutin oluşturuldu.` : 'Bu programın egzersizleri cihazındaki kütüphanede yok.', warning]
          .filter(Boolean)
          .join('\n\n'),
        count > 0
          ? [
              { text: 'Tamam', style: 'cancel' },
              { text: 'Rutinlere git', onPress: () => router.navigate('/workout') },
            ]
          : undefined
      );
    });

  const confirmAdd = (p: GymProgram & { payload: ProgramPayload }) => {
    if (myLinks.length === 0) {
      void add(p);
      return;
    }
    Alert.alert('Yeniden eklensin mi?', 'Bu program rutinlerinde zaten var. Yeni bir kopya oluşturulacak.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Yeniden ekle', onPress: () => void add(p) },
    ]);
  };

  const applyUpdate = (p: GymProgram & { payload: ProgramPayload }) =>
    run('update', async () => {
      const warning = skippedText(await applyProgramUpdate(db, p));
      Alert.alert('Rutinlerin güncellendi', warning ?? 'Geçmiş antrenmanların olduğu gibi duruyor.');
    });

  const confirmUpdate = (p: GymProgram & { payload: ProgramPayload }) => {
    Alert.alert(
      'Rutinlerin güncellensin mi?',
      'Bu programdan eklediğin rutinler programın yeni haline getirilecek; rutinlerde yaptığın değişiklikler kaybolur. Geçmiş antrenmanların etkilenmez.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Güncelle', onPress: () => void applyUpdate(p) },
      ]
    );
  };

  const toggleArchive = () => {
    const archive = program.archivedAt == null;
    const go = () =>
      run('archive', async () => {
        const result = await setProgramArchived(getSupabase(), program.id, archive);
        if (!result.ok) Alert.alert('Yapılamadı', result.error.message);
        await refresh();
      });
    if (!archive) {
      go();
      return;
    }
    Alert.alert(
      'Program arşivlensin mi?',
      'Üyeler ve öğrenciler artık bu programı göremez. Rutinlerine eklemiş olanların rutinleri kalır. İstediğinde arşivden çıkarabilirsin.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Arşivle', style: 'destructive', onPress: go },
      ]
    );
  };

  const confirmUnassign = (studentId: string, name: string | null) => {
    Alert.alert('Atama kaldırılsın mı?', `${studentLabel(name)} bu programı artık göremeyecek. Rutinlerine eklediyse rutinleri kalır.`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kaldır',
        style: 'destructive',
        onPress: () =>
          void run(`unassign:${studentId}`, async () => {
            const result = await unassignProgram(getSupabase(), program.id, studentId);
            if (!result.ok) Alert.alert('Yapılamadı', result.error.message);
            await refresh();
          }),
      },
    ]);
  };

  const ready = payload ? { ...program, payload } : null;

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 pb-12 gap-4"
      refreshControl={
        <RefreshControl
          refreshing={loading && loaded}
          onRefresh={() => void refresh()}
          tintColor={COLORS.accent}
          colors={[COLORS.accent]}
        />
      }
    >
      <Stack.Screen options={{ title: 'Program' }} />
      <View className="gap-1 px-1">
        <Text className="text-fg text-2xl font-bold tracking-tight">{program.name}</Text>
        <Text className="text-muted text-sm">
          {[program.authorName ? trainerTitle(program.authorName) : null, manage ? visibilityLabel(program.visibility) : null]
            .filter(Boolean)
            .join(' · ')}
          {program.archivedAt ? ' · Arşivde' : ''}
        </Text>
        {program.description !== '' && <Text className="text-fg text-base leading-6 mt-2">{program.description}</Text>}
      </View>
      {offline && <Text className="text-muted text-xs leading-5">Çevrimdışı · son çekilen hali gösteriliyor</Text>}
      {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

      {manage && program.archivedAt == null && (
        <View className="gap-3">
          <PrimaryButton
            label="Öğrencilerine ata"
            icon={UserPlus}
            onPress={() => router.push({ pathname: '/programs/assign', params: { id: program.id } })}
          />
          {assigned.length > 0 && (
            <View className="gap-2">
              <SectionHeader title={`Atananlar (${assigned.length})`} variant="label" className="px-1" />
              <Card flush className="px-4">
                {assigned.map((x, i) => (
                  <StudentRow
                    key={x.assignment.id}
                    link={x.link!}
                    divider={i > 0}
                    subtitle="Atandı"
                    actionLabel="Kaldır"
                    busy={busy === `unassign:${x.assignment.studentId}`}
                    onAction={() => confirmUnassign(x.assignment.studentId, x.link!.studentName)}
                  />
                ))}
              </Card>
            </View>
          )}
        </View>
      )}

      {!ready ? (
        <Card>
          <Text className="text-muted text-base leading-6">
            Bu program uygulamanın daha yeni bir sürümüyle hazırlanmış. Görmek için uygulamayı güncelle.
          </Text>
        </Card>
      ) : (
        <>
          {update ? (
            <Card variant="outline" className="gap-3">
              <Text className="text-fg text-base font-semibold">Program güncellendi</Text>
              <Text className="text-muted text-sm leading-5">
                Rutinlerine eklediğinden beri program değişti. Güncellersen rutinlerin yeni hale gelir; geçmiş
                antrenmanların etkilenmez.
              </Text>
              <PrimaryButton
                label={busy === 'update' ? 'Güncelleniyor...' : 'Rutinlerimi güncelle'}
                icon={RefreshCw}
                loading={busy === 'update'}
                onPress={() => confirmUpdate(ready)}
              />
              <SecondaryButton
                label="Böyle kalsın"
                disabled={busy != null}
                onPress={() => void run('keep', () => keepProgramRoutines(ready.id, ready.version))}
              />
            </Card>
          ) : null}
          {manage ? (
            <SecondaryButton
              label={busy === 'add' ? 'Ekleniyor...' : myLinks.length > 0 ? 'Kendi rutinlerime yeniden ekle' : 'Kendi rutinlerime ekle'}
              icon={ListPlus}
              loading={busy === 'add'}
              disabled={busy != null || !libraryLoaded}
              onPress={() => confirmAdd(ready)}
            />
          ) : (
            <PrimaryButton
              label={busy === 'add' ? 'Ekleniyor...' : myLinks.length > 0 ? 'Yeniden ekle' : 'Rutinlerime ekle'}
              icon={ListPlus}
              loading={busy === 'add'}
              disabled={busy != null || !libraryLoaded}
              onPress={() => confirmAdd(ready)}
            />
          )}
          {myLinks.length > 0 && !update && (
            <Text className="text-muted text-xs px-1 -mt-2">Bu program rutinlerinde var ({myLinks.length} rutin).</Text>
          )}

          {ready.payload.days.map((day, di) => (
            <View key={di} className="gap-2">
              <SectionHeader title={day.name} variant="label" className="px-1" />
              <Card flush className="px-4">
                {day.exercises.map((e, i) => (
                  <ProgramExerciseRow
                    key={`${di}-${i}`}
                    exercise={e}
                    info={byId.get(e.exerciseId)}
                    missing={libraryLoaded && !byId.has(e.exerciseId)}
                    divider={i > 0}
                  />
                ))}
              </Card>
            </View>
          ))}
        </>
      )}

      {manage && (
        <View className="gap-3 mt-2">
          <SectionHeader title="Yönet" variant="label" className="px-1" />
          <SecondaryButton
            label="Düzenle"
            icon={Pencil}
            onPress={() => router.push({ pathname: '/programs/edit', params: { id: program.id, gymId: program.gymId } })}
          />
          <SecondaryButton
            label={program.archivedAt ? 'Arşivden çıkar' : 'Arşivle'}
            icon={program.archivedAt ? ArchiveRestore : Archive}
            loading={busy === 'archive'}
            onPress={toggleArchive}
          />
        </View>
      )}
    </ScrollView>
  );
}
