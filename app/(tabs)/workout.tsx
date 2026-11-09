import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SectionList,
  View,
  type PressableProps,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight,
  Copy,
  LayoutList,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';

import { ChooseProgramCard } from '@/components/ChooseProgramCard';
import { CoverImage } from '@/components/CoverImage';
import { useDb } from '@/hooks/useDb';
import { useGymMembership } from '@/hooks/useGymMembership';
import {
  applyProgramUpdate,
  keepProgramRoutines,
  usePrograms,
  useRoutineLinks,
} from '@/hooks/usePrograms';
import { useSheetBottomPadding } from '@/hooks/useSafeBottom';
import { DarkSurface, useColors, useContextTones } from '@/hooks/useTheme';
import { routines } from '@/db/schema';
import { useStartRoutine } from '@/hooks/useStartRoutine';
import {
  programUpdates,
  pruneLinks,
  skippedText,
  updateBadgeText,
  type ProgramUpdate,
} from '@/lib/programs';
import {
  duplicateRoutine,
  groupRoutines,
  loadRoutineCards,
  routineKindLabel,
  type RoutineCardItem,
  type RoutineGroupMember,
} from '@/lib/routineCards';
import { visibleTabs } from '@/lib/tabRoutes';
import { nameCase } from '@/lib/typography';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import {
  Card,
  DisplayName,
  IconButton,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  SectionLabel,
} from '@/components/ui';
import type { WorkoutCover } from '@/lib/coverImage';

type RoutineTarget = Pick<RoutineCardItem, 'id' | 'name'>;

export default function WorkoutScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const db = useDb();
  const insets = useSafeAreaInsets();

  const activeSessionId = useActiveWorkoutStore((s) => s.activeSessionId);
  const { start: startRoutine, starting } = useStartRoutine();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [menuRoutine, setMenuRoutine] = useState<RoutineTarget | null>(null);
  // Salon üyesinde Hareketler sekmesi yok; liste buradan açılır
  const { primary } = useGymMembership();
  const showExercisesEntry = !visibleTabs(primary != null).includes('exercises');

  // Programdan eklenen rutinler (v3.6b): program güncellenince rozet.
  // Bayrak kapalıyken / salon yokken hiçbir şey okunmaz, istek atılmaz.
  const { enabled: programsEnabled, programs, refreshIfStale } = usePrograms();
  const { links: programLinks } = useRoutineLinks(programsEnabled);
  useFocusEffect(
    useCallback(() => {
      if (programLinks.length > 0) refreshIfStale();
    }, [programLinks.length, refreshIfStale])
  );

  // Kart verisi birkaç tablodan geliyor: odaklanınca (hareket planı ve
  // antrenman değişmiş olabilir) ve rutin tablosu değişince (silme, kopyalama,
  // eşitleme) yeniden okunur
  const { updatedAt: routinesChangedAt } = useLiveQuery(db.select({ id: routines.id }).from(routines));
  const [routineList, setRoutineList] = useState<RoutineCardItem[] | null>(null);
  const loadSeq = useRef(0);
  const reload = useCallback(() => {
    const seq = ++loadSeq.current;
    loadRoutineCards(db, new Date())
      .then((rows) => {
        if (seq === loadSeq.current) setRoutineList(rows);
      })
      .catch((err) => console.error('[ROUTINES] Liste okunamadı:', err));
  }, [db]);
  useFocusEffect(reload);
  useEffect(() => {
    if (routinesChangedAt) reload();
  }, [routinesChangedAt, reload]);

  const groups = useMemo(
    () => (routineList ? groupRoutines(routineList, { links: programLinks, programs }) : []),
    [routineList, programLinks, programs]
  );

  const handleDelete = (routine: RoutineTarget) => {
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

  const handleCopy = (routine: RoutineTarget) => {
    duplicateRoutine(db, routine.id).catch((err) => {
      console.error('[ROUTINES] Kopyalanamadı:', err);
      Alert.alert('Hata', String(err));
    });
  };

  const openEditor = (routineId: string) => router.push({ pathname: '/routine/[id]', params: { id: routineId } });

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
      <SectionList
        sections={groups.map((group) => ({ ...group, data: group.members }))}
        keyExtractor={(member) => member.item.id}
        stickySectionHeadersEnabled={false}
        contentContainerClassName="px-5 gap-3 pb-6"
        ListHeaderComponent={
          <View className="gap-3">
            <View className="flex-row items-center justify-between" style={{ paddingTop: insets.top + 12 }}>
              <ScreenTitle>Rutinler</ScreenTitle>
              <IconButton
                icon={Plus}
                variant="brand"
                iconSize={22}
                accessibilityLabel="Yeni rutin"
                onPress={() => router.push('/routine/new')}
              />
            </View>

            {activeSessionId && (
              <Link href="/session/active" asChild>
                <Card variant="accent" className="flex-row items-center py-4">
                  <Play color={COLORS.accentFg} size={18} fill={COLORS.accentFg} />
                  <Text className="text-accent-fg text-base font-semibold ml-3">
                    Aktif antrenmana dön
                  </Text>
                </Card>
              </Link>
            )}

            {updates.map((u) => (
              <ProgramUpdateCard
                key={u.program.id}
                update={u}
                busy={updatingId === u.program.id}
                onUpdate={() => handleProgramUpdate(u)}
                onKeep={() => void keepProgramRoutines(u.program.id, u.program.version)}
              />
            ))}

            <Link href="/templates/recommend" asChild>
              <EntryRow icon={Sparkles} label="Bana program öner" brand />
            </Link>
            {showExercisesEntry && <ExercisesEntry />}
            <Link href="/templates" asChild>
              <EntryRow icon={LayoutList} label="Hazır programlar" />
            </Link>
          </View>
        }
        ListEmptyComponent={
          <DarkSurface className="gap-3">
            <CoverImage cover="karsilama" variant="card" className="h-[180px] rounded-3xl" />
            <ChooseProgramCard label="Henüz rutin yok" />
          </DarkSurface>
        }
        renderSectionHeader={({ section }) => (
          <View className="flex-row items-baseline gap-2 pt-3">
            <Text accessibilityRole="header" className="text-fg text-[15px] font-bold shrink">
              {nameCase(section.title)}
            </Text>
            {section.dayCount != null && <Text className="text-muted text-sm">· {section.dayCount} gün</Text>}
          </View>
        )}
        renderItem={({ item: member }: { item: RoutineGroupMember<RoutineCardItem> }) => (
          <RoutineCoverCard
            routine={member.item}
            cover={member.cover}
            programUpdated={updatedRoutineIds.has(member.item.id)}
            starting={starting}
            onOpen={() => openEditor(member.item.id)}
            onStart={() => void startRoutine(member.item)}
            onMenu={() => setMenuRoutine(member.item)}
          />
        )}
      />

      <RoutineMenu
        routine={menuRoutine}
        onClose={() => setMenuRoutine(null)}
        onEdit={openEditor}
        onCopy={handleCopy}
        onDelete={handleDelete}
      />
    </View>
  );
}

/** Üstteki giriş satırları. `Link asChild` dokunuşu `rest` ile veriyor. */
function EntryRow({ icon: Icon, label, brand = false, ...rest }: { icon: LucideIcon; label: string; brand?: boolean } & PressableProps) {
  const COLORS = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      className={`flex-row items-center gap-3 px-4 h-14 rounded-2xl border active:opacity-70 ${
        brand ? 'border-accent' : 'bg-bg-surface border-border'
      }`}
      {...rest}
    >
      <Icon color={brand ? COLORS.accent : COLORS.muted} size={19} strokeWidth={2} />
      <Text className="flex-1 text-fg text-[15px] font-bold">{label}</Text>
      <ChevronRight color={COLORS.muted} size={18} />
    </Pressable>
  );
}

function ExercisesEntry() {
  return (
    <Link href="/exercise" asChild>
      <EntryRow icon={ListChecks} label="Hareketler" />
    </Link>
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
        <Text className="text-accent text-[13px] font-semibold">
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

/** Ad, ▶ düğmesine binmesin: ekran kenarı (40) + kart içi (32) + düğme alanı (56) */
const COVER_CARD_NAME_INSET = 128;
const COVER_CARD_NAME_SIZES = [24, 22, 20] as const;

/** Fotoğraf koyu: açık temada da koyu kart (ana sayfadaki "Sıradaki" gibi) */
function RoutineCoverCard(props: RoutineCoverCardProps) {
  return (
    <DarkSurface>
      <RoutineCoverCardBody {...props} />
    </DarkSurface>
  );
}

interface RoutineCoverCardProps {
  routine: RoutineCardItem;
  cover: WorkoutCover;
  programUpdated: boolean;
  starting: boolean;
  onOpen: () => void;
  onStart: () => void;
  onMenu: () => void;
}

function RoutineCoverCardBody({ routine, cover, programUpdated, starting, onOpen, onStart, onMenu }: RoutineCoverCardProps) {
  const tones = useContextTones(routine.color);
  const canStart = routine.exerciseCount > 0 && !starting;
  const label = routineKindLabel(routine.kind);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${routine.name}. ${label}. ${routine.line}`}
      className="active:opacity-90"
    >
      <CoverImage cover={cover} variant="card" className="rounded-3xl min-h-[150px] justify-end">
        <View className="p-4 pr-[72px] gap-1">
          <SectionLabel color={routine.color}>{programUpdated ? `${label} · Program güncellendi` : label}</SectionLabel>
          <DisplayName inset={COVER_CARD_NAME_INSET} sizes={COVER_CARD_NAME_SIZES}>
            {routine.name}
          </DisplayName>
          <Text className="text-fg text-[13px]" numberOfLines={1}>
            {routine.line}
          </Text>
        </View>

        <IconButton
          icon={MoreHorizontal}
          variant="ghost"
          accessibilityLabel={`${routine.name} işlemleri`}
          onPress={onMenu}
          className="absolute top-2 right-2 bg-bg/60"
        />
        <Pressable
          onPress={onStart}
          disabled={!canStart}
          accessibilityRole="button"
          accessibilityLabel={`${routine.name} antrenmanını başlat`}
          accessibilityState={{ disabled: !canStart }}
          hitSlop={6}
          className={`absolute bottom-4 right-4 w-12 h-12 rounded-full items-center justify-center active:opacity-80 ${
            canStart ? '' : 'opacity-40'
          }`}
          style={{ backgroundColor: tones.fill }}
        >
          <Play color={tones.onFill} fill={tones.onFill} size={20} />
        </Pressable>
      </CoverImage>
    </Pressable>
  );
}

/** ⋯ menüsü. Android `Alert` üçten çok düğme göstermiyor, alttan sayfa. */
function RoutineMenu({
  routine,
  onClose,
  onEdit,
  onCopy,
  onDelete,
}: {
  routine: RoutineTarget | null;
  onClose: () => void;
  onEdit: (routineId: string) => void;
  onCopy: (routine: RoutineTarget) => void;
  onDelete: (routine: RoutineTarget) => void;
}) {
  const COLORS = useColors();
  const sheetPadding = useSheetBottomPadding();

  // Önce sayfa kapanır, işlem sonraki karede: ekran modalın arkasında açılmasın
  const choose = (action: (target: RoutineTarget) => void) => {
    if (!routine) return;
    const target = routine;
    onClose();
    requestAnimationFrame(() => action(target));
  };

  return (
    <Modal visible={routine != null} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Menüyü kapat" />
        <View className="bg-bg rounded-t-3xl border-t border-border px-3 pt-4" style={{ paddingBottom: sheetPadding + 8 }}>
          <Text className="text-fg text-lg font-bold px-3 pb-2" numberOfLines={1}>
            {routine ? nameCase(routine.name) : ''}
          </Text>
          <MenuRow icon={Pencil} label="Düzenle" color={COLORS.text} onPress={() => choose((r) => onEdit(r.id))} />
          <MenuRow icon={Copy} label="Kopyala" color={COLORS.text} onPress={() => choose(onCopy)} />
          <MenuRow icon={Trash2} label="Sil" color={COLORS.danger} danger onPress={() => choose(onDelete)} />
        </View>
      </View>
    </Modal>
  );
}

function MenuRow({
  icon: Icon,
  label,
  color,
  danger = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3 px-3 h-14 rounded-2xl active:bg-bg-elevated"
    >
      <Icon color={color} size={20} strokeWidth={2} />
      <Text className={`text-base font-semibold ${danger ? 'text-danger' : 'text-fg'}`}>{label}</Text>
    </Pressable>
  );
}
