/**
 * Rutin oluşturma VE düzenleme — tek ekran.
 *
 * Route: /routine/new  → oluşturma modu (id === 'new')
 *        /routine/<id> → düzenleme modu
 *
 * Kaydetme stratejisi (düzenleme modunda): routine_exercises satırlarının
 * tamamı silinip yeniden yazılır. Bu güvenli çünkü routine_exercises'e
 * başka hiçbir tablo referans vermiyor — geçmiş antrenmanlar
 * session_exercises'te ayrı snapshot olarak duruyor, etkilenmezler.
 * Her şey tek transaction içinde.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { asc, eq, sql } from 'drizzle-orm';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { FALLBACK_REST_SECONDS, useAppSettings } from '@/hooks/useAppSettings';
import {
  exercises as exercisesTable,
  routineExercises,
  routines,
  type Exercise,
} from '@/db/schema';
import { newId } from '@/lib/id';
import { ExercisePickerModal } from '@/components/ExercisePickerModal';

interface DraftExercise {
  /** Lokal draft id — kaydederken yeni routine_exercise id'si olarak kullanılır */
  id: string;
  exerciseId: string;
  name: string;
  category: string;
  targetSets: string;
  targetReps: string;
  targetWeightKg: string;
  targetDurationSeconds: string;
  restSeconds: string;
}

export default function RoutineEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const db = useDb();
  const { settings } = useAppSettings();

  const isNew = !id || id === 'new';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);

  // Aynı rutin için yükleme yalnızca bir kez çalışsın; sonraki
  // render'larda formu ezmesin.
  const loadedForIdRef = useRef<string | null>(null);

  // Düzenleme modunda mevcut rutini yükle
  useEffect(() => {
    if (isNew) return;
    if (loadedForIdRef.current === id) return;
    loadedForIdRef.current = id ?? null;

    let cancelled = false;
    let completed = false;

    (async () => {
      try {
        const routineRows = await db
          .select()
          .from(routines)
          .where(eq(routines.id, id!))
          .limit(1);

        if (cancelled) return;

        const routine = routineRows[0];
        if (!routine) {
          completed = true;
          setNotFound(true);
          setLoading(false);
          return;
        }

        setName(routine.name);
        setDescription(routine.description ?? '');

        const rows = await db
          .select({
            re: routineExercises,
            exercise: exercisesTable,
          })
          .from(routineExercises)
          .innerJoin(
            exercisesTable,
            eq(routineExercises.exerciseId, exercisesTable.id)
          )
          .where(eq(routineExercises.routineId, id!))
          .orderBy(asc(routineExercises.orderIndex));

        if (cancelled) return;

        setDraftExercises(
          rows.map((r) => ({
            id: r.re.id,
            exerciseId: r.re.exerciseId,
            name: r.exercise.nameTr ?? r.exercise.name,
            category: r.exercise.category,
            targetSets: r.re.targetSets != null ? String(r.re.targetSets) : '',
            targetReps: r.re.targetReps ?? '',
            targetWeightKg:
              r.re.targetWeightKg != null ? String(r.re.targetWeightKg) : '',
            targetDurationSeconds:
              r.re.targetDurationSeconds != null
                ? String(r.re.targetDurationSeconds)
                : '',
            restSeconds:
              r.re.restSeconds != null ? String(r.re.restSeconds) : '90',
          }))
        );
        completed = true;
        setLoading(false);
      } catch (err) {
        console.error('[ROUTINE-EDIT] Yükleme hatası:', err);
        if (!cancelled) {
          Alert.alert('Hata', 'Rutin yüklenemedi: ' + String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Yükleme tamamlanmadan effect sökülürse (ör. strict mode çift
      // mount) tekrar denenebilsin diye guard'ı serbest bırak.
      if (!completed) loadedForIdRef.current = null;
    };
  }, [db, id, isNew]);

  const addExercises = (selected: Exercise[]) => {
    // Ayarlardaki öntanımlı dinlenme süresi; ayar henüz okunmadıysa 90
    const defaultRest = String(
      settings?.defaultRestSeconds ?? FALLBACK_REST_SECONDS
    );
    const newDrafts: DraftExercise[] = selected.map((ex) => ({
      id: newId(),
      exerciseId: ex.id,
      name: ex.nameTr ?? ex.name,
      category: ex.category,
      targetSets: ex.category === 'cardio' ? '' : '3',
      targetReps: ex.category === 'cardio' ? '' : '10',
      targetWeightKg: '',
      targetDurationSeconds: ex.category === 'cardio' ? '1200' : '',
      restSeconds: ex.category === 'cardio' ? '0' : defaultRest,
    }));
    setDraftExercises((prev) => [...prev, ...newDrafts]);
    setPickerOpen(false);
  };

  const removeExercise = (draftId: string) => {
    setDraftExercises((prev) => prev.filter((e) => e.id !== draftId));
  };

  const moveExercise = (index: number, direction: -1 | 1) => {
    setDraftExercises((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const updateDraft = <K extends keyof DraftExercise>(
    draftId: string,
    key: K,
    value: DraftExercise[K]
  ) => {
    setDraftExercises((prev) =>
      prev.map((e) => (e.id === draftId ? { ...e, [key]: value } : e))
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
      const routineId = isNew ? newId() : id!;
      const expectedCount = draftExercises.length;
      const now = new Date().toISOString();

      const rows = draftExercises.map((d, idx) => ({
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

      console.log('[ROUTINE-SAVE] Başlıyor', {
        mode: isNew ? 'create' : 'edit',
        routineId,
        name: name.trim(),
        expectedCount,
      });

      await db.transaction(async (tx) => {
        if (isNew) {
          await tx.insert(routines).values({
            id: routineId,
            name: name.trim(),
            description: description.trim() || null,
          });
          console.log('[ROUTINE-SAVE] routines insert OK');
        } else {
          await tx
            .update(routines)
            .set({
              name: name.trim(),
              description: description.trim() || null,
              updatedAt: now,
            })
            .where(eq(routines.id, routineId));
          console.log('[ROUTINE-SAVE] routines update OK');

          await tx
            .delete(routineExercises)
            .where(eq(routineExercises.routineId, routineId));
          console.log('[ROUTINE-SAVE] eski routine_exercises silindi');
        }

        await tx.insert(routineExercises).values(rows);
        console.log('[ROUTINE-SAVE] routine_exercises insert OK');
      });

      // Doğrulama
      const verify = await db
        .select({ c: sql<number>`count(*)` })
        .from(routineExercises)
        .where(eq(routineExercises.routineId, routineId));
      const actualCount = verify[0]?.c ?? 0;

      console.log('[ROUTINE-SAVE] Doğrulama:', {
        expected: expectedCount,
        actual: actualCount,
      });

      if (actualCount !== expectedCount) {
        Alert.alert(
          'Uyumsuzluk',
          `${expectedCount} egzersiz gönderildi ama veritabanında ${actualCount} bulundu. Metro loglarını paylaş.`
        );
        return;
      }

      router.back();
    } catch (err) {
      console.error('[ROUTINE-SAVE] HATA:', err);
      Alert.alert('Kaydetme hatası', String(err));
    } finally {
      setSaving(false);
    }
  };

  if (notFound) {
    return (
      <>
        <Stack.Screen options={{ title: 'Rutin' }} />
        <View className="flex-1 bg-bg items-center justify-center p-6">
          <Text className="text-muted text-center">
            Rutin bulunamadı. Silinmiş olabilir.
          </Text>
        </View>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Rutin' }} />
        <View className="flex-1 bg-bg items-center justify-center">
          <ActivityIndicator color="#22c55e" />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: isNew ? 'Yeni Rutin' : 'Rutini Düzenle',
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
                  total={draftExercises.length}
                  onUpdate={updateDraft}
                  onRemove={removeExercise}
                  onMove={moveExercise}
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
  total: number;
  onUpdate: <K extends keyof DraftExercise>(
    id: string,
    key: K,
    value: DraftExercise[K]
  ) => void;
  onRemove: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}

function DraftExerciseCard({
  draft,
  index,
  total,
  onUpdate,
  onRemove,
  onMove,
}: DraftCardProps) {
  const isCardio = draft.category === 'cardio';
  const canMoveUp = index > 0;
  const canMoveDown = index < total - 1;

  return (
    <View className="bg-bg-surface rounded-xl p-4 gap-3">
      <View className="flex-row items-center">
        <View className="mr-2">
          <Pressable
            onPress={() => onMove(index, -1)}
            disabled={!canMoveUp}
            hitSlop={4}
          >
            <ChevronUp color={canMoveUp ? '#94a3b8' : '#334155'} size={18} />
          </Pressable>
          <Pressable
            onPress={() => onMove(index, 1)}
            disabled={!canMoveDown}
            hitSlop={4}
          >
            <ChevronDown
              color={canMoveDown ? '#94a3b8' : '#334155'}
              size={18}
            />
          </Pressable>
        </View>
        <Text className="text-white font-semibold flex-1">
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
            placeholder="ops."
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
