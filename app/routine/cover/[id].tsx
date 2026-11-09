/**
 * Rutin kapağı (v4.0b Bölüm 5): görsel, program / bölge etiketi, ad, işlemler,
 * hareket listesi ve altta sabit "Başla". Düzenleme ayrı ekranda
 * (`/routine/[id]`). Fotoğraf koyu olduğu için açık temada da koyu.
 */

import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Copy, History, MoreHorizontal, Pencil, Play, Trash2, type LucideIcon } from 'lucide-react-native';

import { CoverImage } from '@/components/CoverImage';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { RoutineMenu, type RoutineTarget } from '@/components/RoutineMenu';
import { DisplayName, IconButton, PrimaryButton } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { useDb } from '@/hooks/useDb';
import { usePrograms, useRoutineLinks } from '@/hooks/usePrograms';
import { useRoutineActions } from '@/hooks/useRoutineActions';
import { useRoutineCards } from '@/hooks/useRoutineCards';
import { useStartRoutine } from '@/hooks/useStartRoutine';
import { DarkSurface, useColors, useContextTones } from '@/hooks/useTheme';
import type { WorkoutCover } from '@/lib/coverImage';
import {
  findRoutineInGroups,
  loadRoutineExercises,
  routineCoverLabel,
  type RoutineCardItem,
  type RoutineExerciseRow,
} from '@/lib/routineCards';

const COVER_HEIGHT = 460;
const COVER_NAME_SIZES = [46, 38, 30] as const;
/** Sayfa kenarları (20 + 20) */
const COVER_NAME_INSET = 40;

export default function RoutineCoverScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const db = useDb();
  const { enabled, programs } = usePrograms();
  const { links } = useRoutineLinks(enabled);
  const { routineList, groups } = useRoutineCards({ links, programs });
  const { confirmDelete, copy } = useRoutineActions();
  const [menuRoutine, setMenuRoutine] = useState<RoutineTarget | null>(null);
  const [exercises, setExercises] = useState<RoutineExerciseRow[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadRoutineExercises(db, id)
        .then((rows) => {
          if (!cancelled) setExercises(rows);
        })
        .catch((err) => console.error('[ROUTINES] Hareketler okunamadı:', err));
      return () => {
        cancelled = true;
      };
    }, [db, id])
  );

  const found = useMemo(() => findRoutineInGroups(groups, id), [groups, id]);

  const openEditor = (routineId: string) => router.push({ pathname: '/routine/[id]', params: { id: routineId } });
  const handleDelete = (routine: RoutineTarget) => confirmDelete(routine, () => router.back());
  const handleCopy = (routine: RoutineTarget) =>
    copy(routine, () => Alert.alert('Rutin kopyalandı', 'Kopyası Rutinlerim bölümünde.'));

  return (
    <>
      <DarkSurface className="flex-1">
        <StatusBar style="light" />
        {found ? (
          <CoverBody
            routine={found.member.item}
            cover={found.member.cover}
            label={routineCoverLabel(found.member.item.kind, found.group, found.member.dayIndex)}
            exercises={exercises}
            onMenu={() => setMenuRoutine(found.member.item)}
            onHistory={() =>
              router.push({ pathname: '/history', params: { routineId: found.member.item.id } })
            }
            onEdit={() => openEditor(found.member.item.id)}
            onCopy={() => handleCopy(found.member.item)}
            onDelete={() => handleDelete(found.member.item)}
          />
        ) : (
          <NotFound loaded={routineList != null} />
        )}
      </DarkSurface>

      <RoutineMenu
        routine={menuRoutine}
        onClose={() => setMenuRoutine(null)}
        onEdit={openEditor}
        onCopy={handleCopy}
        onDelete={handleDelete}
      />
    </>
  );
}

function CoverBody({
  routine,
  cover,
  label,
  exercises,
  onMenu,
  onHistory,
  onEdit,
  onCopy,
  onDelete,
}: {
  routine: RoutineCardItem;
  cover: WorkoutCover;
  label: string;
  exercises: RoutineExerciseRow[] | null;
  onMenu: () => void;
  onHistory: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const COLORS = useColors();
  const tones = useContextTones(routine.color);
  const { start, starting } = useStartRoutine();

  return (
    <View className="flex-1 bg-bg">
      <ScrollView className="flex-1" contentContainerClassName="pb-4">
        <CoverImage cover={cover} variant="page" className="justify-end" style={{ height: COVER_HEIGHT }}>
          <View className="px-5 gap-2.5">
            <Text className="text-xs font-bold tracking-widest" style={{ color: tones.ink }}>
              {label}
            </Text>
            <DisplayName accessibilityRole="header" inset={COVER_NAME_INSET} sizes={COVER_NAME_SIZES}>
              {routine.name}
            </DisplayName>
            <Text className="text-fg text-sm">{routine.stats}</Text>
          </View>
        </CoverImage>

        <View className="px-5 pt-4 gap-4">
          <View className="flex-row gap-2">
            <ActionSquare icon={History} label="Geçmiş" color={COLORS.text} onPress={onHistory} />
            <ActionSquare icon={Pencil} label="Düzenle" color={COLORS.text} onPress={onEdit} />
            <ActionSquare icon={Copy} label="Kopyala" color={COLORS.text} onPress={onCopy} />
            <ActionSquare icon={Trash2} label="Sil" color={COLORS.danger} onPress={onDelete} />
          </View>

          {routine.description != null && routine.description !== '' && (
            <Text className="text-muted text-sm leading-5">{routine.description}</Text>
          )}

          {exercises != null && exercises.length === 0 && (
            <Text className="text-muted text-sm">Bu rutinde hareket yok. Düzenle'den ekleyebilirsin.</Text>
          )}

          <View className="gap-2">
            {exercises?.map((e) => (
              <View key={e.id} className="flex-row items-center gap-3 p-2.5 rounded-2xl bg-bg-surface border border-border">
                <ExerciseThumb imagePaths={e.imagePaths} category={e.category} primaryMuscles={e.primaryMuscles} size={44} />
                <View className="flex-1">
                  <Text className="text-fg text-[15px] font-bold">{e.name}</Text>
                  <Text className="text-muted text-xs mt-0.5">{e.line}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View
        pointerEvents="box-none"
        className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4"
        style={{ paddingTop: insets.top + 8 }}
      >
        <IconButton icon={ChevronLeft} variant="ghost" iconSize={22} accessibilityLabel="Geri" onPress={() => router.back()} className="bg-bg/60" />
        <IconButton icon={MoreHorizontal} variant="ghost" iconSize={22} accessibilityLabel="Diğer işlemler" onPress={onMenu} className="bg-bg/60" />
      </View>

      <View className="px-5 pt-3 pb-4 bg-bg">
        <PrimaryButton
          label={starting ? 'Başlatılıyor…' : 'Başla'}
          icon={Play}
          iconFill
          disabled={starting || routine.exerciseCount === 0}
          onPress={() => void start(routine)}
        />
      </View>
    </View>
  );
}

function ActionSquare({
  icon: Icon,
  label,
  color,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-1 h-[62px] rounded-2xl border border-border bg-bg-surface items-center justify-center gap-1.5 active:opacity-70"
    >
      <Icon color={color} size={20} strokeWidth={1.8} />
      <Text className="text-fg text-xs font-semibold">{label}</Text>
    </Pressable>
  );
}

/** Rutin silinmiş (eşitlemeyle de olabilir) */
function NotFound({ loaded }: { loaded: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg px-4" style={{ paddingTop: insets.top + 8 }}>
      <IconButton icon={ChevronLeft} accessibilityLabel="Geri" onPress={() => router.back()} />
      {loaded && <Text className="text-muted text-base text-center mt-10">Bu rutin artık yok.</Text>}
    </View>
  );
}
