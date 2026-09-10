import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, asc, eq, like, or } from 'drizzle-orm';
import { Check, Search, X } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { exercises, type Exercise } from '@/db/schema';
import { getExerciseCoverUrl } from '@/lib/exerciseImage';

type CategoryFilter = 'all' | 'strength' | 'cardio' | 'stretching';

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'Hepsi' },
  { value: 'strength', label: 'Güç' },
  { value: 'cardio', label: 'Kardiyo' },
  { value: 'stretching', label: 'Esneklik' },
];

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
  const [category, setCategory] = useState<CategoryFilter>('all');
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
    const conditions = [eq(exercises.isArchived, false)];
    if (category !== 'all') {
      conditions.push(eq(exercises.category, category));
    }
    if (search.trim()) {
      const pattern = `%${search.trim()}%`;
      conditions.push(
        or(like(exercises.name, pattern), like(exercises.nameTr, pattern))!
      );
    }
    return db
      .select()
      .from(exercises)
      .where(and(...conditions))
      .orderBy(asc(exercises.name))
      .limit(200);
  }, [db, category, search]);

  const { data } = useLiveQuery(query, [category, search]);

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
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-bg-surface">
          <Pressable onPress={onClose} hitSlop={10}>
            <X color="#fff" size={24} />
          </Pressable>
          <Text className="text-white text-lg font-semibold">{title}</Text>
          <Pressable
            onPress={handleConfirm}
            disabled={selectedIds.size === 0}
            className={`px-4 py-1.5 rounded-full ${
              selectedIds.size === 0 ? 'bg-bg-surface' : 'bg-accent'
            }`}
          >
            <Text
              className={`font-semibold ${
                selectedIds.size === 0 ? 'text-muted' : 'text-bg'
              }`}
            >
              Ekle ({selectedIds.size})
            </Text>
          </Pressable>
        </View>

        {/* Arama */}
        <View className="px-4 pt-3 pb-2 gap-3">
          <View className="flex-row items-center bg-bg-surface rounded-xl px-3 h-11">
            <Search color="#64748b" size={18} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Egzersiz ara..."
              placeholderTextColor="#64748b"
              className="flex-1 text-white ml-2"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <X color="#64748b" size={16} />
              </Pressable>
            )}
          </View>

          <View className="flex-row gap-2">
            {CATEGORY_OPTIONS.map((opt) => {
              const active = category === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setCategory(opt.value)}
                  className={`px-3 py-1.5 rounded-full ${
                    active ? 'bg-accent' : 'bg-bg-surface'
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      active ? 'text-bg' : 'text-white'
                    }`}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
          contentContainerClassName="px-4 pt-2 pb-6"
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
  const muscles = parseJsonArray(exercise.primaryMuscles);
  const displayName = exercise.nameTr ?? exercise.name;

  return (
    <Pressable
      onPress={onToggle}
      className={`flex-row items-center bg-bg-surface rounded-xl p-3 ${
        selected ? 'border border-accent' : ''
      }`}
    >
      <View className="w-12 h-12 rounded-lg bg-bg-elevated overflow-hidden items-center justify-center">
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={{ width: 48, height: 48 }}
            resizeMode="cover"
          />
        ) : (
          <Text className="text-muted text-xs">
            {exercise.category === 'cardio' ? '🏃' : '💪'}
          </Text>
        )}
      </View>
      <View className="flex-1 ml-3">
        <Text className="text-white font-semibold" numberOfLines={1}>
          {displayName}
        </Text>
        <Text className="text-muted text-xs" numberOfLines={1}>
          {muscles.join(', ') || exercise.category}
        </Text>
      </View>
      <View
        className={`w-6 h-6 rounded-full items-center justify-center ${
          selected ? 'bg-accent' : 'border border-bg-elevated'
        }`}
      >
        {selected && <Check color="#0f172a" size={14} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
