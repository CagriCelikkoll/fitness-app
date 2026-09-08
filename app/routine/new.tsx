import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { GripVertical, Plus, Trash2 } from 'lucide-react-native';

import * as schema from '@/db/schema';
import {
  exercises as exercisesTable,
  routineExercises,
  routines,
  type Exercise,
} from '@/db/schema';
import { newId } from '@/lib/id';
import { ExercisePickerModal } from '@/components/ExercisePickerModal';

interface DraftExercise {
  id: string; // routine_exercise local id
  exerciseId: string;
  name: string;
  category: string;
  targetSets: string; // input olarak string tutuyoruz, kaydederken parse
  targetReps: string;
  targetWeightKg: string;
  targetDurationSeconds: string;
  restSeconds: string;
}

export default function NewRoutineScreen() {
  const router = useRouter();
  const sqliteDb = useSQLiteContext();
  const db = drizzle(sqliteDb, { schema });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const addExercises = (selected: Exercise[]) => {
    const newDrafts: DraftExercise[] = selected.map((ex) => ({
      id: newId(),
      exerciseId: ex.id,
      name: ex.nameTr ?? ex.name,
      category: ex.category,
      targetSets: ex.category === 'cardio' ? '' : '3',
      targetReps: ex.category === 'cardio' ? '' : '10',
      targetWeightKg: '',
      targetDurationSeconds: ex.category === 'cardio' ? '1200' : '',
      restSeconds: ex.category === 'cardio' ? '0' : '90',
    }));
    setDraftExercises((prev) => [...prev, ...newDrafts]);
    setPickerOpen(false);
  };

  const removeExercise = (id: string) => {
    setDraftExercises((prev) => prev.filter((e) => e.id !== id));
  };

  const updateDraft = <K extends keyof DraftExercise>(
    id: string,
    key: K,
    value: DraftExercise[K]
  ) => {
    setDraftExercises((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [key]: value } : e))
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Hata', 'Rutin için bir isim gir.');
      return;
    }
    if (draftExercises.length === 0) {
      Alert.alert('Hata', 'En az bir egzersiz ekle.');
      return;
    }

    setSaving(true);
    try {
      const routineId = newId();
      await db.insert(routines).values({
        id: routineId,
        name: name.trim(),
        description: description.trim() || null,
      });

      const routineExerciseRows = draftExercises.map((d, idx) => ({
        id: d.id,
        routineId,
        exerciseId: d.exerciseId,
        orderIndex: idx,
        targetSets: parseIntOrNull(d.targetSets),
        targetReps: d.targetReps.trim() || null,
        targetWeightKg: parseFloatOrNull(d.targetWeightKg),
        targetDurationSeconds: parseIntOrNull(d.targetDurationSeconds),
        restSeconds: parseIntOrNull(d.restSeconds) ?? 90,
      }));
      await db.insert(routineExercises).values(routineExerciseRows);

      router.back();
    } catch (err) {
      console.error('Rutin kaydedilirken hata:', err);
      Alert.alert('Hata', String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Yeni Rutin',
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#fff',
          headerRight: () => (
            <Pressable
              onPress={handleSave}
              disabled={saving}
              className="mr-2"
              hitSlop={8}
            >
              <Text
                className={`font-semibold ${
                  saving ? 'text-muted' : 'text-accent'
                }`}
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </Text>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 bg-bg"
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="p-4 gap-4 pb-32"
          keyboardShouldPersistTaps="handled"
        >
          {/* Rutin meta bilgileri */}
          <View className="bg-bg-surface rounded-xl p-4 gap-3">
            <View>
              <Text className="text-muted text-xs mb-1">Rutin Adı</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Örn: Push Day"
                placeholderTextColor="#64748b"
                className="text-white text-lg font-semibold"
              />
            </View>
            <View>
              <Text className="text-muted text-xs mb-1">
                Açıklama (opsiyonel)
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Göğüs, omuz, triceps odaklı"
                placeholderTextColor="#64748b"
                className="text-white"
                multiline
              />
            </View>
          </View>

          {/* Egzersizler */}
          {draftExercises.length === 0 ? (
            <View className="bg-bg-surface rounded-xl p-6 items-center">
              <Text className="text-muted text-center mb-3">
                Henüz egzersiz eklemedin.
              </Text>
              <Pressable
                onPress={() => setPickerOpen(true)}
                className="bg-accent px-4 py-2 rounded-full flex-row items-center"
              >
                <Plus color="#0f172a" size={16} />
                <Text className="text-bg font-semibold ml-1">
                  Egzersiz Ekle
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              {draftExercises.map((draft, idx) => (
                <DraftExerciseCard
                  key={draft.id}
                  draft={draft}
                  index={idx}
                  onUpdate={updateDraft}
                  onRemove={removeExercise}
                />
              ))}
              <Pressable
                onPress={() => setPickerOpen(true)}
                className="bg-bg-surface border border-dashed border-bg-elevated rounded-xl p-4 items-center flex-row justify-center"
              >
                <Plus color="#22c55e" size={18} />
                <Text className="text-accent font-semibold ml-2">
                  Egzersiz Ekle
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ExercisePickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={addExercises}
        title="Rutine Egzersiz Ekle"
      />
    </>
  );
}

interface DraftCardProps {
  draft: DraftExercise;
  index: number;
  onUpdate: <K extends keyof DraftExercise>(
    id: string,
    key: K,
    value: DraftExercise[K]
  ) => void;
  onRemove: (id: string) => void;
}

function DraftExerciseCard({
  draft,
  index,
  onUpdate,
  onRemove,
}: DraftCardProps) {
  const isCardio = draft.category === 'cardio';

  return (
    <View className="bg-bg-surface rounded-xl p-4 gap-3">
      <View className="flex-row items-center">
        <GripVertical color="#64748b" size={18} />
        <Text className="text-white font-semibold flex-1 ml-2">
          {index + 1}. {draft.name}
        </Text>
        <Pressable onPress={() => onRemove(draft.id)} hitSlop={8}>
          <Trash2 color="#ef4444" size={18} />
        </Pressable>
      </View>

      {isCardio ? (
        <View className="flex-row gap-2">
          <NumberField
            label="Süre (sn)"
            value={draft.targetDurationSeconds}
            onChange={(v) => onUpdate(draft.id, 'targetDurationSeconds', v)}
            placeholder="1200"
          />
        </View>
      ) : (
        <View className="flex-row gap-2">
          <NumberField
            label="Set"
            value={draft.targetSets}
            onChange={(v) => onUpdate(draft.id, 'targetSets', v)}
            placeholder="3"
          />
          <NumberField
            label="Tekrar"
            value={draft.targetReps}
            onChange={(v) => onUpdate(draft.id, 'targetReps', v)}
            placeholder="8-12"
            keyboardType="default"
          />
          <NumberField
            label="Ağırlık (kg)"
            value={draft.targetWeightKg}
            onChange={(v) => onUpdate(draft.id, 'targetWeightKg', v)}
            placeholder="opsiyonel"
            keyboardType="decimal-pad"
          />
        </View>
      )}

      <View className="flex-row gap-2">
        <NumberField
          label="Dinlenme (sn)"
          value={draft.restSeconds}
          onChange={(v) => onUpdate(draft.id, 'restSeconds', v)}
          placeholder="90"
        />
      </View>
    </View>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  keyboardType = 'number-pad',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'number-pad' | 'decimal-pad' | 'default';
}) {
  return (
    <View className="flex-1">
      <Text className="text-muted text-xs mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#64748b"
        keyboardType={keyboardType}
        className="bg-bg-elevated text-white px-3 py-2 rounded-lg"
      />
    </View>
  );
}

function parseIntOrNull(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? null : n;
}

function parseFloatOrNull(v: string): number | null {
  const trimmed = v.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}
