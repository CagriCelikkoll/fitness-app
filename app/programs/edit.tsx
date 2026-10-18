/**
 * Program editörü (v3.6b, hoca / yönetici).
 *
 * Route: /programs/edit?gymId=…               → yeni program
 *        /programs/edit?gymId=…&template=ppl  → hazır programdan taslak
 *        /programs/edit?id=…                  → düzenleme
 *
 * Rutin editörünün parçaları: egzersiz seçici (`ExercisePickerModal`),
 * set / tekrar / dinlenme alanları (`NumberField`). Günler (en fazla 7)
 * ve her egzersize hoca notu. "Salon programı" / "Yalnızca öğrencilerim".
 * Kullanıcının kendi eklediği egzersizler programa girmez (üyelerin
 * kütüphanesinde yok). Sınırları sunucu da denetliyor.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react-native';

import type { Exercise } from '@/db/schema';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import { useGymMembership } from '@/hooks/useGymMembership';
import { usePrograms } from '@/hooks/usePrograms';
import { useColors } from '@/hooks/useTheme';
import { digitsOnly, sanitizeRepRange } from '@/lib/format';
import { canViewMembers } from '@/lib/gymAdmin';
import {
  PROGRAM_LIMITS,
  PROGRAM_SCHEMA,
  canManageProgram,
  parseRepRange,
  repsText,
  saveProgram,
  templateToDraft,
  validateProgram,
  type ProgramPayload,
  type ProgramVisibility,
} from '@/lib/programs';
import { getSupabase } from '@/lib/supabase';
import { getTemplate } from '@/lib/workoutTemplates';
import { ExercisePickerModal } from '@/components/ExercisePickerModal';
import { NumberField } from '@/components/NumberField';
import { Card, Chip, SecondaryButton } from '@/components/ui';

interface DraftExercise {
  key: string;
  exerciseId: string;
  sets: string;
  reps: string;
  rest: string;
  notes: string;
}

interface DraftDay {
  key: string;
  name: string;
  exercises: DraftExercise[];
}

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

/** A, B, C … */
const dayLetter = (i: number) => String.fromCharCode(65 + i);

function toDraftDays(payload: ProgramPayload): DraftDay[] {
  return payload.days.map((d) => ({
    key: nextKey(),
    name: d.name,
    exercises: d.exercises.map((e) => ({
      key: nextKey(),
      exerciseId: e.exerciseId,
      sets: String(e.sets),
      reps: repsText(e.repsMin, e.repsMax),
      rest: String(e.restSec),
      notes: e.notes ?? '',
    })),
  }));
}

/** Taslak → payload; tekrar alanı geçersizse hata metni */
function toPayload(days: DraftDay[]): { payload: ProgramPayload } | { error: string } {
  const out: ProgramPayload = { schema: PROGRAM_SCHEMA, days: [] };
  for (const [i, d] of days.entries()) {
    const label = d.name.trim() || `${i + 1}. gün`;
    const exercises = [];
    for (const e of d.exercises) {
      const reps = parseRepRange(e.reps);
      if (!reps) return { error: `"${label}": tekrarı "10" ya da "8-12" gibi yaz.` };
      exercises.push({
        exerciseId: e.exerciseId,
        sets: parseInt(e.sets, 10) || 0,
        repsMin: reps.min,
        repsMax: reps.max,
        restSec: e.rest.trim() === '' ? 0 : parseInt(e.rest, 10),
        notes: e.notes.trim() || null,
      });
    }
    out.days.push({ name: d.name.trim(), exercises });
  }
  return { payload: out };
}

export default function ProgramEditorScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; gymId?: string; template?: string }>();
  const { memberships } = useGymMembership();
  const { userId, programs, loaded, refresh } = usePrograms();

  const existing = params.id ? (programs.find((p) => p.id === params.id) ?? null) : null;
  const gymId = existing?.gymId ?? params.gymId ?? null;
  const allowed = existing
    ? canManageProgram(existing, userId, memberships)
    : gymId != null && canViewMembers(gymId, memberships);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ProgramVisibility>('students');
  const [days, setDays] = useState<DraftDay[]>(() => [{ key: nextKey(), name: 'A', exercises: [] }]);
  const [pickerDay, setPickerDay] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Taslak yalnızca bir kez kurulsun; liste yenilenince formu ezmesin
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    if (params.id) {
      if (!existing?.payload) return;
      initRef.current = true;
      setName(existing.name);
      setDescription(existing.description);
      setVisibility(existing.visibility);
      setDays(toDraftDays(existing.payload));
      return;
    }
    initRef.current = true;
    const template = params.template ? getTemplate(params.template) : undefined;
    if (template) {
      const draft = templateToDraft(template);
      setName(draft.name);
      setDescription(draft.description);
      setDays(toDraftDays(draft.payload));
    }
  }, [params.id, params.template, existing]);

  const { byId } = useExerciseLookup(days.flatMap((d) => d.exercises.map((e) => e.exerciseId)));

  const updateDay = (key: string, fn: (d: DraftDay) => DraftDay) =>
    setDays((prev) => prev.map((d) => (d.key === key ? fn(d) : d)));

  const updateExercise = (dayKey: string, exKey: string, patch: Partial<DraftExercise>) =>
    updateDay(dayKey, (d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === exKey ? { ...e, ...patch } : e)) }));

  const moveExercise = (dayKey: string, index: number, dir: -1 | 1) =>
    updateDay(dayKey, (d) => {
      const to = index + dir;
      if (to < 0 || to >= d.exercises.length) return d;
      const list = [...d.exercises];
      [list[index], list[to]] = [list[to], list[index]];
      return { ...d, exercises: list };
    });

  const addExercises = (selected: Exercise[]) => {
    const dayKey = pickerDay;
    setPickerDay(null);
    if (!dayKey) return;
    const custom = selected.filter((e) => e.isCustom);
    const usable = selected.filter((e) => !e.isCustom);
    if (custom.length > 0) {
      Alert.alert(
        'Bazı egzersizler eklenmedi',
        'Kendi eklediğin egzersizler üyelerin kütüphanesinde yok; programa yalnızca uygulamadaki hazır egzersizler eklenebilir.'
      );
    }
    updateDay(dayKey, (d) => {
      const room = PROGRAM_LIMITS.exercisesMax - d.exercises.length;
      const added = usable.slice(0, Math.max(0, room)).map((e) => ({
        key: nextKey(),
        exerciseId: e.id,
        sets: '3',
        reps: '10',
        rest: '90',
        notes: '',
      }));
      return { ...d, exercises: [...d.exercises, ...added] };
    });
  };

  const addDay = () =>
    setDays((prev) =>
      prev.length >= PROGRAM_LIMITS.daysMax ? prev : [...prev, { key: nextKey(), name: dayLetter(prev.length), exercises: [] }]
    );

  const removeDay = (day: DraftDay) => {
    const go = () => setDays((prev) => prev.filter((d) => d.key !== day.key));
    if (day.exercises.length === 0) {
      go();
      return;
    }
    Alert.alert('Gün silinsin mi?', `"${day.name || 'Bu gün'}" ve egzersizleri programdan çıkacak.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: go },
    ]);
  };

  const handleSave = async () => {
    if (saving || !gymId) return;
    const built = toPayload(days);
    if ('error' in built) {
      Alert.alert('Eksik bilgi', built.error);
      return;
    }
    const problem = validateProgram({ name, description, payload: built.payload });
    if (problem) {
      Alert.alert('Eksik bilgi', problem);
      return;
    }
    setSaving(true);
    const result = await saveProgram(getSupabase(), {
      id: existing?.id ?? null,
      gymId,
      name,
      description,
      visibility,
      payload: built.payload,
    });
    if (!result.ok) {
      setSaving(false);
      Alert.alert('Kaydedilemedi', result.error.message);
      return;
    }
    await refresh();
    setSaving(false);
    if (existing) router.back();
    else router.replace({ pathname: '/programs/[id]', params: { id: result.value } });
  };

  if (!allowed || (params.id && !existing)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Program' }} />
        <Text className="text-muted text-base text-center">
          {params.id && !loaded ? 'Yükleniyor…' : 'Bu programı düzenleme yetkin yok ya da program bulunamadı.'}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: existing ? 'Programı Düzenle' : 'Yeni Program',
          headerRight: () => (
            <Pressable onPress={handleSave} disabled={saving} className="mr-2" hitSlop={12}>
              <Text className={`font-semibold ${saving ? 'text-muted' : 'text-accent'}`}>
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
        <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 gap-3 pb-32" keyboardShouldPersistTaps="handled">
          <Card className="gap-4">
            <View>
              <Text className="text-muted text-xs uppercase tracking-widest mb-2">Program adı</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Örn: Başlangıç – Full Body"
                placeholderTextColor={COLORS.muted}
                maxLength={PROGRAM_LIMITS.nameMax}
                className="text-fg text-2xl font-bold tracking-tight py-1"
              />
            </View>
            <View className="pt-4 border-t border-border">
              <Text className="text-muted text-xs uppercase tracking-widest mb-2">Açıklama (opsiyonel)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Kimin için, haftada kaç gün"
                placeholderTextColor={COLORS.muted}
                maxLength={PROGRAM_LIMITS.descriptionMax}
                className="text-fg text-base"
                multiline
              />
            </View>
            <View className="pt-4 border-t border-border gap-2">
              <Text className="text-muted text-xs uppercase tracking-widest">Kimler görür</Text>
              <View className="flex-row gap-2 flex-wrap">
                <Chip label="Yalnızca öğrencilerim" active={visibility === 'students'} onPress={() => setVisibility('students')} />
                <Chip label="Salon programı" active={visibility === 'gym'} onPress={() => setVisibility('gym')} />
              </View>
              <Text className="text-muted text-xs leading-5">
                {visibility === 'gym'
                  ? 'Salonun bütün üyeleri görür ve rutinlerine ekleyebilir.'
                  : 'Yalnızca "Ata" ile seçtiğin aktif öğrencilerin görür.'}
              </Text>
            </View>
          </Card>

          {days.map((day, di) => (
            <Card key={day.key} className="gap-3">
              <View className="flex-row items-center gap-2">
                <Text className="text-muted text-xs uppercase tracking-widest">{di + 1}. gün</Text>
                <TextInput
                  value={day.name}
                  onChangeText={(v) => updateDay(day.key, (d) => ({ ...d, name: v }))}
                  placeholder="Gün adı"
                  placeholderTextColor={COLORS.muted}
                  maxLength={PROGRAM_LIMITS.dayNameMax}
                  className="flex-1 text-fg text-lg font-semibold py-1"
                />
                {days.length > 1 && (
                  <Pressable
                    onPress={() => removeDay(day)}
                    hitSlop={4}
                    accessibilityLabel="Günü sil"
                    className="w-10 h-10 -mr-2 items-center justify-center rounded-full active:bg-bg-elevated"
                  >
                    <Trash2 color={COLORS.muted} size={17} strokeWidth={1.75} />
                  </Pressable>
                )}
              </View>

              {day.exercises.map((e, i) => (
                <View key={e.key} className="gap-3 pt-3 border-t border-border">
                  <View className="flex-row items-center">
                    <View className="mr-3 -ml-1">
                      <Pressable
                        onPress={() => moveExercise(day.key, i, -1)}
                        disabled={i === 0}
                        hitSlop={{ top: 8, bottom: 2, left: 8, right: 8 }}
                        className="w-8 h-6 items-center justify-center"
                      >
                        <ChevronUp color={i > 0 ? COLORS.muted : COLORS.disabledIcon} size={20} />
                      </Pressable>
                      <Pressable
                        onPress={() => moveExercise(day.key, i, 1)}
                        disabled={i === day.exercises.length - 1}
                        hitSlop={{ top: 2, bottom: 8, left: 8, right: 8 }}
                        className="w-8 h-6 items-center justify-center"
                      >
                        <ChevronDown
                          color={i < day.exercises.length - 1 ? COLORS.muted : COLORS.disabledIcon}
                          size={20}
                        />
                      </Pressable>
                    </View>
                    <Text className="flex-1 text-fg text-base font-semibold" numberOfLines={2}>
                      {i + 1}. {byId.get(e.exerciseId)?.name ?? 'Kütüphanede bulunamadı'}
                    </Text>
                    <Pressable
                      onPress={() =>
                        updateDay(day.key, (d) => ({ ...d, exercises: d.exercises.filter((x) => x.key !== e.key) }))
                      }
                      hitSlop={4}
                      accessibilityLabel="Egzersizi çıkar"
                      className="w-10 h-10 -mr-2 items-center justify-center rounded-full active:bg-bg-elevated"
                    >
                      <Trash2 color={COLORS.muted} size={17} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                  <View className="flex-row gap-2">
                    <NumberField
                      label="Set"
                      value={e.sets}
                      onChange={(v) => updateExercise(day.key, e.key, { sets: digitsOnly(v) })}
                      placeholder="3"
                      maxLength={2}
                    />
                    <NumberField
                      label="Tekrar"
                      value={e.reps}
                      onChange={(v) => updateExercise(day.key, e.key, { reps: sanitizeRepRange(v, e.reps) })}
                      placeholder="8-12"
                      keyboardType="default"
                    />
                    <NumberField
                      label="Dinlenme (sn)"
                      value={e.rest}
                      onChange={(v) => updateExercise(day.key, e.key, { rest: digitsOnly(v) })}
                      placeholder="90"
                      maxLength={3}
                    />
                  </View>
                  <TextInput
                    value={e.notes}
                    onChangeText={(v) => updateExercise(day.key, e.key, { notes: v })}
                    placeholder="Hoca notu (opsiyonel)"
                    placeholderTextColor={COLORS.muted}
                    maxLength={PROGRAM_LIMITS.notesMax}
                    className="bg-bg-elevated text-fg text-sm px-4 py-3 rounded-xl"
                    multiline
                  />
                </View>
              ))}

              {day.exercises.length < PROGRAM_LIMITS.exercisesMax && (
                <Pressable
                  onPress={() => setPickerDay(day.key)}
                  className="min-h-[48px] border border-dashed border-border rounded-2xl items-center flex-row justify-center active:bg-bg-surface"
                >
                  <Plus color={COLORS.text} size={18} />
                  <Text className="text-fg text-base font-semibold ml-2">Egzersiz ekle</Text>
                </Pressable>
              )}
            </Card>
          ))}

          {days.length < PROGRAM_LIMITS.daysMax && <SecondaryButton label="Gün ekle" icon={Plus} onPress={addDay} />}
        </ScrollView>
      </KeyboardAvoidingView>

      <ExercisePickerModal
        visible={pickerDay != null}
        onClose={() => setPickerDay(null)}
        onConfirm={addExercises}
        title="Programa Egzersiz Ekle"
      />
    </>
  );
}
