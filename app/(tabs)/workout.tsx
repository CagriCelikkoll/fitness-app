import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { asc, count, eq } from 'drizzle-orm';
import {
  Dumbbell,
  LayoutList,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import {
  applyProgramUpdate,
  keepProgramRoutines,
  usePrograms,
  useRoutineLinks,
} from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import {
  routineExercises,
  routines,
  type Routine,
} from '@/db/schema';
import { EXERCISE_IMAGE_CACHE } from '@/lib/exerciseImage';
import {
  programUpdates,
  pruneLinks,
  skippedText,
  updateBadgeText,
  type ProgramUpdate,
} from '@/lib/programs';
import {
  createSessionFromRoutine,
  sessionExerciseImageUrls,
} from '@/lib/startSession';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import {
  Card,
  EmptyState,
  ListRow,
  PrimaryButton,
  SecondaryButton,
} from '@/components/ui';

export default function WorkoutScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const db = useDb();

  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);
  const startSession = useActiveWorkoutStore((s) => s.startSession);
  const [starting, setStarting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Programdan eklenen rutinler (v3.6b): program güncellenince rozet.
  // Bayrak kapalıyken / salon yokken hiçbir şey okunmaz, istek atılmaz.
  const { enabled: programsEnabled, programs, refreshIfStale } = usePrograms();
  const { links: programLinks } = useRoutineLinks(programsEnabled);
  useFocusEffect(
    useCallback(() => {
      if (programLinks.length > 0) refreshIfStale();
    }, [programLinks.length, refreshIfStale])
  );

  // Tüm aktif (arşivlenmemiş) rutinleri canlı sorgu ile çek
  const { data: routineList } = useLiveQuery(
    db
      .select({
        id: routines.id,
        name: routines.name,
        description: routines.description,
        exerciseCount: count(routineExercises.id),
      })
      .from(routines)
      .leftJoin(routineExercises, eq(routineExercises.routineId, routines.id))
      .where(eq(routines.isArchived, false))
      .groupBy(routines.id)
      .orderBy(asc(routines.name))
  );

  useEffect(() => {
    // Yalnızca geliştirmede: mağaza derlemesinde her değişimde tüm listeyi yazmasın
    if (__DEV__ && routineList) {
      console.log('[ROUTINE-LIST]', JSON.stringify(routineList, null, 2));
    }
  }, [routineList]);

  const handleStartRoutine = async (routine: Routine) => {
    if (starting) return;
    setStarting(true);
    try {
      const sessionId = await createSessionFromRoutine(db, routine);

      if (sessionId == null) {
        Alert.alert(
          'Boş Rutin',
          'Bu rutin egzersiz içermiyor. Önce egzersiz ekle.'
        );
        return;
      }

      startSession(sessionId);
      router.push('/session/active');

      // Hareket görsellerini arka planda önbelleğe al; salonda internet
      // olmasa da detayda görünsünler. Beklenmiyor, hata antrenmanı etkilemez.
      sessionExerciseImageUrls(db, sessionId)
        .then((urls) =>
          urls.length > 0 ? Image.prefetch(urls, EXERCISE_IMAGE_CACHE) : true
        )
        .catch((err) => console.warn('[IMAGE-PREFETCH] Atlandı:', err));
    } catch (err) {
      console.error('Antrenman başlatılırken hata:', err);
      Alert.alert('Hata', String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleDelete = (routine: Routine) => {
    Alert.alert(
      'Rutini Sil',
      `"${routine.name}" rutinini silmek istediğine emin misin?`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            await db.delete(routines).where(eq(routines.id, routine.id));
          },
        },
      ]
    );
  };

  const updates: ProgramUpdate[] =
    routineList && programLinks.length > 0
      ? programUpdates(pruneLinks(programLinks, new Set(routineList.map((r) => r.id))), programs)
      : [];
  const updatedRoutineIds = new Set(updates.flatMap((u) => u.routineIds));

  const handleProgramUpdate = (u: ProgramUpdate) => {
    const payload = u.program.payload;
    if (!payload || updatingId) return;
    Alert.alert(
      'Rutinler güncellensin mi?',
      `"${u.program.name}" programından eklediğin rutinler programın yeni haline getirilecek; rutinlerde yaptığın değişiklikler kaybolur. Geçmiş antrenmanların etkilenmez.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Güncelle',
          onPress: async () => {
            setUpdatingId(u.program.id);
            try {
              const warning = skippedText(await applyProgramUpdate(db, { ...u.program, payload }));
              if (warning) Alert.alert('Rutinlerin güncellendi', warning);
            } catch (err) {
              console.error('[PROGRAMS] Güncelleme hatası:', err);
              Alert.alert('Hata', String(err));
            } finally {
              setUpdatingId(null);
            }
          },
        },
      ]
    );
  };

  if (!routineList) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {/* Aktif session uyarısı */}
      {activeSessionId && (
        <View className="px-5 pt-4">
          <Link href="/session/active" asChild>
            <Card variant="accent" className="flex-row items-center py-4">
              <Play color={COLORS.accentFg} size={18} fill={COLORS.accentFg} />
              <Text className="text-accent-fg text-base font-semibold ml-3">
                Aktif antrenmana dön
              </Text>
            </Card>
          </Link>
        </View>
      )}

      {routineList.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={Dumbbell}
          title="Henüz rutin yok"
          description="İlk antrenman rutinini oluşturarak başla. Egzersizleri seç, hedef set/tekrar ata, başlat."
          action={
            <View className="gap-3">
              <Link href="/templates" asChild>
                <PrimaryButton label="Hazır Program Seç" icon={LayoutList} />
              </Link>
              <Link href="/routine/new" asChild>
                <SecondaryButton
                  label="İlk Rutini Oluştur"
                  icon={Plus}
                />
              </Link>
            </View>
          }
        />
      ) : (
        <FlatList
          data={routineList}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View className="gap-3">
              {updates.map((u) => (
                <ProgramUpdateCard
                  key={u.program.id}
                  update={u}
                  busy={updatingId === u.program.id}
                  onUpdate={() => handleProgramUpdate(u)}
                  onKeep={() =>
                    void keepProgramRoutines(u.program.id, u.program.version)
                  }
                />
              ))}
              <Link href="/templates" asChild>
                <ListRow chevron className="px-1">
                  <View className="flex-row items-center">
                    <LayoutList color={COLORS.muted} size={17} strokeWidth={1.75} />
                    <Text className="text-muted text-sm ml-3">
                      Hazır programlara göz at
                    </Text>
                  </View>
                </ListRow>
              </Link>
            </View>
          }
          renderItem={({ item }) => (
            <RoutineCard
              routine={{
                id: item.id,
                name: item.name,
                description: item.description,
              }}
              exerciseCount={item.exerciseCount}
              programUpdated={updatedRoutineIds.has(item.id)}
              onStart={() =>
                handleStartRoutine({
                  id: item.id,
                  name: item.name,
                  description: item.description,
                } as Routine)
              }
              onDelete={() =>
                handleDelete({
                  id: item.id,
                  name: item.name,
                  description: item.description,
                } as Routine)
              }
              starting={starting}
            />
          )}
          contentContainerClassName="px-5 pt-4 gap-3 pb-28"
        />
      )}

      {/* FAB: Yeni rutin */}
      {routineList.length > 0 && (
        <Link href="/routine/new" asChild>
          <Pressable className="absolute bottom-6 right-5 bg-accent w-14 h-14 rounded-full items-center justify-center active:opacity-80">
            <Plus color={COLORS.accentFg} size={26} strokeWidth={2.5} />
          </Pressable>
        </Link>
      )}
    </View>
  );
}

/**
 * Programdan eklenen rutinlerin programı güncellendi (v3.6b): "Güncelle"
 * (onaylı) ya da "Böyle kalsın" (bu sürüm için rozet kalkar).
 */
function ProgramUpdateCard({
  update,
  busy,
  onUpdate,
  onKeep,
}: {
  update: ProgramUpdate;
  busy: boolean;
  onUpdate: () => void;
  onKeep: () => void;
}) {
  return (
    <Card variant="outline" className="gap-3">
      <View>
        <Text className="text-accent text-xs font-semibold uppercase tracking-widest">
          {updateBadgeText(update.program)}
        </Text>
        <Text className="text-fg text-base font-semibold mt-1">
          {update.program.name}
        </Text>
        <Text className="text-muted text-sm mt-1">
          {update.routineIds.length} rutin bu programdan. Geçmiş antrenmanların etkilenmez.
        </Text>
      </View>
      <View className="flex-row gap-2">
        <PrimaryButton
          label={busy ? 'Güncelleniyor...' : 'Güncelle'}
          icon={RefreshCw}
          loading={busy}
          className="flex-1"
          onPress={onUpdate}
        />
        <SecondaryButton
          label="Böyle kalsın"
          className="flex-1"
          disabled={busy}
          onPress={onKeep}
        />
      </View>
    </Card>
  );
}

interface RoutineCardProps {
  routine: { id: string; name: string; description: string | null };
  exerciseCount: number;
  /** Programdan eklendi ve program güncellendi (v3.6b) */
  programUpdated?: boolean;
  onStart: () => void;
  onDelete: () => void;
  starting: boolean;
}

function RoutineCard({
  routine,
  exerciseCount,
  programUpdated = false,
  onStart,
  onDelete,
  starting,
}: RoutineCardProps) {
  const COLORS = useColors();
  return (
    <Card>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-fg text-xl font-semibold tracking-tight">
            {routine.name}
          </Text>
          {programUpdated && (
            <Text className="text-accent text-xs font-semibold mt-1">
              Program güncellendi
            </Text>
          )}
          {routine.description && (
            <Text className="text-muted text-sm mt-1" numberOfLines={2}>
              {routine.description}
            </Text>
          )}
          <Text className="text-muted text-xs uppercase tracking-widest mt-3 tabular-nums">
            {exerciseCount} egzersiz
          </Text>
        </View>
        <View className="flex-row items-center -mr-2 -mt-2">
          <Link
            href={{ pathname: '/routine/[id]', params: { id: routine.id } }}
            asChild
          >
            <Pressable
              hitSlop={4}
              className="w-10 h-10 items-center justify-center rounded-full active:bg-bg-elevated"
            >
              <Pencil color={COLORS.muted} size={17} strokeWidth={1.75} />
            </Pressable>
          </Link>
          <Pressable
            onPress={onDelete}
            hitSlop={4}
            className="w-10 h-10 items-center justify-center rounded-full active:bg-bg-elevated"
          >
            <Trash2 color={COLORS.muted} size={17} strokeWidth={1.75} />
          </Pressable>
        </View>
      </View>

      <PrimaryButton
        onPress={onStart}
        disabled={starting || exerciseCount === 0}
        label={starting ? 'Başlatılıyor...' : 'Antrenmanı Başlat'}
        icon={Play}
        iconFill
        className="mt-5"
      />
    </Card>
  );
}
