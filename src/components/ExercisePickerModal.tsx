import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { upperTr } from '@/lib/typography';
import { Text, TextInput } from '@/components/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { inArray } from 'drizzle-orm';
import { Check, ChevronLeft, Info, Search, X } from 'lucide-react-native';

import { ExerciseThumb } from '@/components/ExerciseThumb';
import { useDb } from '@/hooks/useDb';
import { useColors } from '@/hooks/useTheme';
import { exercises, type Exercise } from '@/db/schema';
import {
  EXERCISE_FILTER_OPTIONS,
  categoryLabel,
  muscleLabels,
} from '@/lib/exerciseTaxonomy';
import {
  OTHER_EXERCISES_TITLE,
  exerciseDisplayName,
  exerciseOriginalName,
  showOtherLabel,
  type ExerciseListItem,
} from '@/lib/exerciseCatalog';
import { useExerciseList } from '@/hooks/useExerciseList';
import {
  addSelectionLabel,
  discardSelectionMessage,
  missingSelectionIds,
  pendingSelectionCount,
  pickerBackAction,
  resolveSelection,
  selectionFromIds,
  selectionOrder,
  toggleInSelection,
  type PickerSelection,
} from '@/lib/pickerSelection';
import { Chip, DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui';
import { ExerciseDetailContent } from '@/components/ExerciseDetailContent';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (selected: Exercise[]) => void;
  title?: string;
  /** Önceden seçilmiş id'ler — örn. rutinde zaten var olanları işaretli göster */
  initiallySelectedIds?: string[];
  /** Tek seçim modu (varsayılan: çoklu) */
  singleSelect?: boolean;
}

export function ExercisePickerModal({
  visible,
  onClose,
  onConfirm,
  title = 'Egzersiz Seç',
  initiallySelectedIds = [],
  singleSelect = false,
}: Props) {
  const COLORS = useColors();
  const db = useDb();

  const [search, setSearch] = useState('');
  const [filterId, setFilterId] = useState('all');
  // Seçimler nesneyle ve seçim sırasıyla: arama/filtre değişince listeden
  // çıkan seçim de onayda eklenebilsin (bkz. src/lib/pickerSelection.ts)
  const [selected, setSelected] = useState<PickerSelection<Exercise>>(() =>
    selectionFromIds(initiallySelectedIds)
  );
  // Önizlenen egzersiz. İç içe ikinci bir Modal yerine aynı Modal'da
  // görünüm değişiyor (iOS'ta iç içe modaller sorunlu; router.push ise
  // detayı modalın arkasında açardı).
  const [previewExercise, setPreviewExercise] = useState<Exercise | null>(
    null
  );
  // "Seçimler eklenmedi" onayı (v3.8): ayrı Alert yerine aynı Modal'da
  // katman — Android Alert'te yıkıcı düğme kırmızı olmuyor.
  const [confirmingExit, setConfirmingExit] = useState(false);
  // v3.8: varsayılan liste core; extra "Diğer egzersizleri göster" ile
  const [showExtra, setShowExtra] = useState(false);

  const { items, refreshUsed } = useExerciseList({
    filterId,
    search,
    showExtra,
    extraUsedIds: initiallySelectedIds,
  });

  // Modal her açıldığında seçimleri sıfırla — kapatıp tekrar açınca
  // önceki seçimler yapışık kalmasın.
  useEffect(() => {
    if (visible) {
      setSelected(selectionFromIds(initiallySelectedIds));
      setSearch('');
      setPreviewExercise(null);
      setConfirmingExit(false);
      setShowExtra(false);
      refreshUsed();
    }
    // initiallySelectedIds referansı her render'da değişebileceği için
    // bağımlılığa sadece visible koyuyoruz (açılış anındaki değer yeterli).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggleSelection = (exercise: Exercise) => {
    setSelected((prev) => toggleInSelection(prev, exercise, singleSelect));
  };

  /** Önizlemedeki "Seç" / "Seçimden Çıkar": seçimi değiştirip listeye döner */
  const togglePreviewSelection = () => {
    if (!previewExercise) return;
    toggleSelection(previewExercise);
    setPreviewExercise(null);
  };

  const handleConfirm = async () => {
    // Nesnesi olmayanlar yalnızca initiallySelectedIds'ten gelir
    const missing = missingSelectionIds(selected);
    let loaded: Exercise[] = [];
    if (missing.length > 0) {
      try {
        loaded = await db
          .select()
          .from(exercises)
          .where(inArray(exercises.id, missing));
      } catch (err) {
        console.error('[PICKER] Seçili egzersizler okunamadı:', err);
        return;
      }
    }
    setConfirmingExit(false);
    onConfirm(resolveSelection(selected, loaded));
    setSelected(selectionFromIds(initiallySelectedIds));
  };

  const pendingCount = pendingSelectionCount(selected, initiallySelectedIds);
  const order = useMemo(() => selectionOrder(selected), [selected]);

  /** Üstteki kapat ve geri: eklenmemiş seçim varsa önce onay */
  const requestClose = () => {
    if (pickerBackAction(selected, initiallySelectedIds) === 'confirm') {
      setConfirmingExit(true);
    } else {
      onClose();
    }
  };

  const discardAndClose = () => {
    setConfirmingExit(false);
    onClose();
  };

  // Android geri tuşu / hareketi: önce onay katmanı, sonra önizleme
  // kapansın; seçiciyi en son kapatır
  const handleBack = () => {
    if (confirmingExit) setConfirmingExit(false);
    else if (previewExercise) setPreviewExercise(null);
    else requestClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleBack}
    >
      <SafeAreaView className="flex-1 bg-bg">
        {previewExercise && (
          <PreviewView
            exercise={previewExercise}
            selected={selected.has(previewExercise.id)}
            onBack={() => setPreviewExercise(null)}
            onToggle={togglePreviewSelection}
          />
        )}

        {/* Liste görünümü: önizleme açıkken unmount edilmiyor, gizleniyor —
            arama, filtre, seçim ve kaydırma konumu olduğu gibi kalsın. */}
        <View
          className="flex-1"
          style={previewExercise ? { display: 'none' } : undefined}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-3 py-3 border-b border-border">
            <Pressable
              onPress={requestClose}
              hitSlop={6}
              accessibilityLabel="Kapat"
              className="w-11 h-11 items-center justify-center rounded-full active:bg-bg-elevated"
            >
              <X color={COLORS.text} size={22} />
            </Pressable>
            <Text
              className="text-fg text-lg font-semibold tracking-tight flex-1 text-center px-2"
              numberOfLines={1}
            >
              {title}
            </Text>
            <Pressable
              onPress={handleConfirm}
              disabled={selected.size === 0}
              className={`px-4 h-10 justify-center rounded-full ${
                selected.size === 0 ? 'bg-bg-elevated' : 'bg-accent'
              }`}
            >
              <Text
                className={`font-semibold tabular-nums ${
                  selected.size === 0 ? 'text-muted' : 'text-accent-fg'
                }`}
              >
                Ekle ({selected.size})
              </Text>
            </Pressable>
          </View>

          {/* Arama */}
          <View className="px-5 pt-4 pb-3 gap-3">
            <View className="flex-row items-center bg-bg-elevated rounded-2xl px-4 h-12">
              <Search color={COLORS.muted} size={18} strokeWidth={1.75} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Egzersiz ara..."
                placeholderTextColor={COLORS.muted}
                className="flex-1 text-fg text-base ml-3"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={12}>
                  <X color={COLORS.muted} size={16} />
                </Pressable>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="-mx-5 grow-0"
              contentContainerClassName="px-5 gap-2"
              keyboardShouldPersistTaps="handled"
            >
              {EXERCISE_FILTER_OPTIONS.map((opt) => (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  active={filterId === opt.id}
                  onPress={() => setFilterId(opt.id)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Liste */}
          <FlatList
            data={items ?? []}
            keyExtractor={listItemKey}
            renderItem={({ item }) =>
              item.kind === 'exercise' ? (
                <PickerRow
                  exercise={item.exercise}
                  order={order.get(item.exercise.id) ?? null}
                  onToggle={() => toggleSelection(item.exercise)}
                  onPreview={() => setPreviewExercise(item.exercise)}
                />
              ) : item.kind === 'otherHeader' ? (
                <OtherHeader />
              ) : (
                <ShowOtherButton count={item.count} onPress={() => setShowExtra(true)} />
              )
            }
            extraData={order}
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="px-5 pt-1 pb-8"
            ItemSeparatorComponent={() => <View className="h-2" />}
            ListEmptyComponent={
              <Text className="text-muted text-center mt-8">
                Egzersiz bulunamadı.
              </Text>
            }
          />

          {/* Sabit ekleme düğmesi (v3.8): üstteki küçük düğme gözden
              kaçıyordu. SafeAreaView alt kenarı gezinme çubuğunun üstünde. */}
          {selected.size > 0 && (
            <View className="px-5 pt-3 pb-3 border-t border-border bg-bg">
              <PrimaryButton
                label={addSelectionLabel(selected.size)}
                icon={Check}
                onPress={() => void handleConfirm()}
              />
            </View>
          )}
        </View>

        {confirmingExit && (
          <DiscardConfirm
            count={pendingCount}
            onAdd={() => void handleConfirm()}
            onDiscard={discardAndClose}
            onCancel={() => setConfirmingExit(false)}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function PreviewView({
  exercise,
  selected,
  onBack,
  onToggle,
}: {
  exercise: Exercise;
  selected: boolean;
  onBack: () => void;
  onToggle: () => void;
}) {
  const COLORS = useColors();
  return (
    <View className="flex-1">
      <View className="flex-row items-center px-3 py-3 border-b border-border">
        <Pressable
          onPress={onBack}
          hitSlop={6}
          className="w-11 h-11 items-center justify-center rounded-full active:bg-bg-elevated"
        >
          <ChevronLeft color={COLORS.text} size={24} />
        </Pressable>
        <Text
          className="text-fg text-lg font-semibold tracking-tight flex-1 px-2"
          numberOfLines={1}
        >
          {exerciseDisplayName(exercise)}
        </Text>
      </View>

      {/* "İlerlemen" kapalı: useFocusEffect Modal içinde güvenilir değil */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4 gap-3 pb-6"
      >
        <ExerciseDetailContent exercise={exercise} />
      </ScrollView>

      <View className="px-5 py-3 border-t border-border bg-bg">
        {selected ? (
          <SecondaryButton label="Seçimden Çıkar" onPress={onToggle} />
        ) : (
          <PrimaryButton label="Seç" icon={Check} onPress={onToggle} />
        )}
      </View>
    </View>
  );
}

/**
 * "Seçimler eklenmedi": eklenmemiş seçim varken geri. Aynı Modal içinde
 * katman (iç içe Modal yok).
 */
function DiscardConfirm({
  count,
  onAdd,
  onDiscard,
  onCancel,
}: {
  count: number;
  onAdd: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Pressable
      className="absolute inset-0 bg-black/60 justify-center px-6"
      onPress={onCancel}
      accessibilityViewIsModal
    >
      <Pressable
        onPress={() => {}}
        className="bg-bg-surface rounded-3xl p-5 gap-3 border border-border"
      >
        <Text className="text-fg text-lg font-bold tracking-tight">
          Seçimler eklenmedi
        </Text>
        <Text className="text-muted text-base leading-6 mb-1">
          {discardSelectionMessage(count)}
        </Text>
        <PrimaryButton label="Ekle ve çık" icon={Check} onPress={onAdd} />
        <DangerButton label="Çıkış yap" solid onPress={onDiscard} />
        <SecondaryButton label="Vazgeç" onPress={onCancel} />
      </Pressable>
    </Pressable>
  );
}

function PickerRow({
  exercise,
  order,
  onToggle,
  onPreview,
}: {
  exercise: Exercise;
  /** Seçim sırası (1, 2, 3…); seçili değilse null */
  order: number | null;
  onToggle: () => void;
  /** ⓘ: seçimi değiştirmeden önizlemeyi açar */
  onPreview: () => void;
}) {
  const COLORS = useColors();
  const muscles = muscleLabels(exercise.primaryMuscles);
  const displayName = exerciseDisplayName(exercise);
  const originalName = exerciseOriginalName(exercise);
  const selected = order != null;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? `${displayName}, ${order}. seçim` : displayName}
      className={`flex-row items-center rounded-3xl p-3 border ${
        selected ? 'bg-accent/10 border-accent' : 'bg-bg-surface border-border'
      }`}
    >
      {/* Görsel + tik (seçiliyse köşede) */}
      <View>
        <ExerciseThumb
          imagePaths={exercise.imagePaths}
          category={exercise.category}
          primaryMuscles={exercise.primaryMuscles}
        />
        {selected && (
          <View className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-accent items-center justify-center border-2 border-bg-surface">
            <Check color={COLORS.accentFg} size={11} strokeWidth={3.5} />
          </View>
        )}
      </View>
      <View className="flex-1 ml-4">
        <Text className="text-fg text-base font-semibold" numberOfLines={1}>
          {displayName}
        </Text>
        {originalName != null && (
          <Text className="text-muted text-xs" numberOfLines={1}>
            {originalName}
          </Text>
        )}
        <Text className="text-muted text-xs mt-1" numberOfLines={1}>
          {muscles.join(', ') || categoryLabel(exercise.category)}
        </Text>
      </View>
      <Pressable
        onPress={onPreview}
        hitSlop={8}
        accessibilityLabel="Egzersizi incele"
        className="w-10 h-10 items-center justify-center rounded-full mr-1 active:bg-bg-elevated"
      >
        <Info color={COLORS.muted} size={20} strokeWidth={1.75} />
      </Pressable>
      {/* Seçim sırası: egzersizler bu sırayla eklenir */}
      <View
        className={`w-7 h-7 rounded-full items-center justify-center mr-1 ${
          selected ? 'bg-accent' : 'border-2 border-border'
        }`}
      >
        {selected && (
          <Text className="text-accent-fg text-sm font-bold tabular-nums">
            {order}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function listItemKey(item: ExerciseListItem<Exercise>): string {
  return item.kind === 'exercise' ? item.exercise.id : item.kind;
}

/** Aramada ya da açılınca extra hareketlerin başlığı (v3.8) */
export function OtherHeader() {
  return (
    <Text className="text-muted text-xs font-bold tracking-widest px-1 pt-4 pb-1">
      {upperTr(OTHER_EXERCISES_TITLE)}
    </Text>
  );
}

/** Listenin altında "Diğer egzersizleri göster (N)" */
export function ShowOtherButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="items-center py-4 rounded-2xl active:bg-bg-elevated"
    >
      <Text className="text-accent text-sm font-semibold">{showOtherLabel(count)}</Text>
    </Pressable>
  );
}
