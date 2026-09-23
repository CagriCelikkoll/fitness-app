import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Check, Search, X } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { exercises, type Exercise } from '@/db/schema';
import { getExerciseCoverUrl } from '@/lib/exerciseImage';
import {
  exerciseListCondition,
  exerciseListOrder,
} from '@/lib/exerciseFilter';
import {
  EXERCISE_FILTER_OPTIONS,
  categoryLabel,
  muscleLabels,
} from '@/lib/exerciseTaxonomy';
import { COLORS } from '@/theme';
import { Chip } from '@/components/ui';

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
  const db = useDb();

  const [search, setSearch] = useState('');
  const [filterId, setFilterId] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initiallySelectedIds)
  );

  // Modal her açıldığında seçimleri sıfırla — kapatıp tekrar açınca
  // önceki seçimler yapışık kalmasın.
  useEffect(() => {
    if (visible) {
      setSelectedIds(new Set(initiallySelectedIds));
      setSearch('');
    }
    // initiallySelectedIds referansı her render'da değişebileceği için
    // bağımlılığa sadece visible koyuyoruz (açılış anındaki değer yeterli).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const query = useMemo(() => {
    const option =
      EXERCISE_FILTER_OPTIONS.find((o) => o.id === filterId) ??
      EXERCISE_FILTER_OPTIONS[0]!;
    return db
      .select()
      .from(exercises)
      .where(exerciseListCondition(option.filter, search))
      .orderBy(...exerciseListOrder(option.filter));
  }, [db, filterId, search]);

  const { data } = useLiveQuery(query, [filterId, search]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(singleSelect ? [] : prev);
      if (prev.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (!data) return;
    const selected = data.filter((e) => selectedIds.has(e.id));
    onConfirm(selected);
    setSelectedIds(new Set(initiallySelectedIds));
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-bg">
        {/* Header */}
        <View className="flex-row items-center justify-between px-3 py-3 border-b border-border">
          <Pressable
            onPress={onClose}
            hitSlop={6}
            className="w-11 h-11 items-center justify-center rounded-full active:bg-bg-elevated"
          >
            <X color={COLORS.text} size={22} />
          </Pressable>
          <Text
            className="text-white text-lg font-semibold tracking-tight flex-1 text-center px-2"
            numberOfLines={1}
          >
            {title}
          </Text>
          <Pressable
            onPress={handleConfirm}
            disabled={selectedIds.size === 0}
            className={`px-4 h-10 justify-center rounded-full ${
              selectedIds.size === 0 ? 'bg-bg-elevated' : 'bg-accent'
            }`}
          >
            <Text
              className={`font-semibold tabular-nums ${
                selectedIds.size === 0 ? 'text-muted' : 'text-accent-fg'
              }`}
            >
              Ekle ({selectedIds.size})
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
              className="flex-1 text-white text-base ml-3"
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
          data={data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PickerRow
              exercise={item}
              selected={selectedIds.has(item.id)}
              onToggle={() => toggleSelection(item.id)}
            />
          )}
          contentContainerClassName="px-5 pt-1 pb-8"
          ItemSeparatorComponent={() => <View className="h-2" />}
          ListEmptyComponent={
            <Text className="text-muted text-center mt-8">
              Egzersiz bulunamadı.
            </Text>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

function PickerRow({
  exercise,
  selected,
  onToggle,
}: {
  exercise: Exercise;
  selected: boolean;
  onToggle: () => void;
}) {
  const coverUrl = getExerciseCoverUrl(exercise.imagePaths);
  const muscles = muscleLabels(exercise.primaryMuscles);
  const displayName = exercise.nameTr ?? exercise.name;

  return (
    <Pressable
      onPress={onToggle}
      className={`flex-row items-center bg-bg-surface rounded-3xl p-3 border ${
        selected ? 'border-accent' : 'border-border'
      }`}
    >
      <View className="w-14 h-14 rounded-2xl bg-bg-elevated overflow-hidden items-center justify-center">
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={{ width: 56, height: 56 }}
            resizeMode="cover"
          />
        ) : (
          <Text className="text-muted text-xs">
            {exercise.category === 'cardio' ? '🏃' : '💪'}
          </Text>
        )}
      </View>
      <View className="flex-1 ml-4">
        <Text className="text-white text-base font-semibold" numberOfLines={1}>
          {displayName}
        </Text>
        <Text className="text-muted text-xs mt-1" numberOfLines={1}>
          {muscles.join(', ') || categoryLabel(exercise.category)}
        </Text>
      </View>
      <View
        className={`w-7 h-7 rounded-full items-center justify-center mr-1 ${
          selected ? 'bg-accent' : 'border-2 border-border'
        }`}
      >
        {selected && (
          <Check color={COLORS.accentFg} size={15} strokeWidth={3} />
        )}
      </View>
    </Pressable>
  );
}
