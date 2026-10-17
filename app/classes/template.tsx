/**
 * Ders ekle / düzenle (v3.2c, yalnızca yönetici): gün, başlangıç saati,
 * süre, ders adı, hoca adı, slogan, kapasite (yumuşak, isteğe bağlı), etkin. Düzenlemede "Dersi sil".
 * Kaydetmeden çıkarken "Vazgeçilsin mi?". Yetkiyi sunucu belirler.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';

import { useClassSchedule } from '@/hooks/useClassSchedule';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import {
  INSTRUCTOR_MAX,
  NAME_MAX,
  TAGLINE_MAX,
  WEEKDAY_SHORT_TR,
  canEditSchedule,
  createTemplate,
  deleteTemplate,
  emptyTemplateDraft,
  isTemplateDraftDirty,
  sanitizeTimeInput,
  templateDraftError,
  templateToDraft,
  updateTemplate,
  type TemplateDraft,
  type Weekday,
} from '@/lib/classes';
import { digitsOnly } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';
import { Card, Chip, DangerButton, PrimaryButton } from '@/components/ui';

const INPUT_CLASS = 'bg-bg-elevated text-fg text-base px-4 rounded-xl h-12';
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export default function ClassTemplateScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const { gymId, id } = useLocalSearchParams<{ gymId: string; id?: string }>();
  const { memberships } = useGymMembership();
  const { templates, exceptions, refresh } = useClassSchedule();

  const existing = id ? (templates.find((t) => t.id === id) ?? null) : null;
  const [original] = useState<TemplateDraft>(() => (existing ? templateToDraft(existing) : emptyTemplateDraft()));
  const [draft, setDraft] = useState<TemplateDraft>(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);

  const dirty = isTemplateDraftDirty(draft, original);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (leaving.current || !dirty) return;
      e.preventDefault();
      Alert.alert('Vazgeçilsin mi?', 'Kaydedilmemiş değişiklikler kaybolacak.', [
        { text: 'Düzenlemeye devam', style: 'cancel' },
        { text: 'Vazgeç', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsubscribe;
  }, [navigation, dirty]);

  const title = existing ? 'Dersi düzenle' : 'Ders ekle';

  if (id && !existing) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title }} />
        <Text className="text-muted text-base text-center">Ders bulunamadı. Silinmiş olabilir.</Text>
      </View>
    );
  }
  if (!gymId || !canEditSchedule(gymId, memberships)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title }} />
        <Text className="text-muted text-base text-center">Programı yalnızca salon yöneticisi düzenleyebilir.</Text>
      </View>
    );
  }

  const validation = templateDraftError(draft);
  const set = (patch: Partial<TemplateDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const hasExceptions = existing != null && exceptions.some((e) => e.templateId === existing.id);

  const finish = async () => {
    leaving.current = true;
    await refresh();
    router.back();
  };

  const save = async () => {
    if (validation || busy) return;
    setBusy(true);
    setError(null);
    const client = getSupabase();
    const result = existing ? await updateTemplate(client, existing.id, draft) : await createTemplate(client, gymId, draft);
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      return;
    }
    await finish();
  };

  const confirmDelete = () => {
    if (!existing) return;
    Alert.alert(
      'Ders silinsin mi?',
      'Her haftadan kaldırılır; bu derse ait iptal ve değişiklikler de silinir. Yalnızca bir süre ara verilecekse "Programda göster"i kapat.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const result = await deleteTemplate(getSupabase(), existing.id);
            if (!result.ok) {
              setBusy(false);
              setError(result.error.message);
              return;
            }
            await finish();
          },
        },
      ]
    );
  };

  const count = (text: string) => [...text.trim()].length;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
      <Stack.Screen options={{ title }} />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 gap-4 pb-12" keyboardShouldPersistTaps="handled">
        <Card className="gap-4">
          <View className="gap-2">
            <Text className="text-muted text-xs">Gün</Text>
            <View className="flex-row flex-wrap gap-2">
              {WEEKDAYS.map((w) => (
                <Chip
                  key={w}
                  label={WEEKDAY_SHORT_TR[w - 1]}
                  size="sm"
                  active={draft.weekday === w}
                  onPress={() => !busy && set({ weekday: w })}
                />
              ))}
            </View>
            {hasExceptions && draft.weekday !== original.weekday && (
              <Text className="text-danger text-xs leading-5">
                Gün değişince bu dersin tek günlük iptal ve değişiklikleri silinir.
              </Text>
            )}
          </View>

          <View className="flex-row gap-3">
            <Field label="Başlangıç" className="flex-1">
              <TextInput
                value={draft.startTime}
                onChangeText={(t) => set({ startTime: sanitizeTimeInput(t) })}
                keyboardType="number-pad"
                placeholder="19:30"
                placeholderTextColor={COLORS.muted}
                editable={!busy}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Süre (dk)" className="flex-1">
              <TextInput
                value={draft.durationMin}
                onChangeText={(t) => set({ durationMin: digitsOnly(t).slice(0, 3) })}
                keyboardType="number-pad"
                placeholder="60"
                placeholderTextColor={COLORS.muted}
                editable={!busy}
                className={INPUT_CLASS}
              />
            </Field>
          </View>

          <Field label="Ders adı" count={count(draft.name)} max={NAME_MAX}>
            <TextInput
              value={draft.name}
              onChangeText={(t) => set({ name: t })}
              placeholder="Ör. Zumba"
              placeholderTextColor={COLORS.muted}
              editable={!busy}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Hoca" count={count(draft.instructorName)} max={INSTRUCTOR_MAX}>
            <TextInput
              value={draft.instructorName}
              onChangeText={(t) => set({ instructorName: t })}
              placeholder="Ör. Bilgin Hoca"
              placeholderTextColor={COLORS.muted}
              editable={!busy}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Slogan (isteğe bağlı)" count={count(draft.tagline)} max={TAGLINE_MAX}>
            <TextInput
              value={draft.tagline}
              onChangeText={(t) => set({ tagline: t })}
              placeholder="Ör. Ritmini Hisset"
              placeholderTextColor={COLORS.muted}
              editable={!busy}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label="Kapasite (isteğe bağlı)">
            <TextInput
              value={draft.capacity}
              onChangeText={(t) => set({ capacity: digitsOnly(t).slice(0, 3) })}
              keyboardType="number-pad"
              placeholder="Sınırsız"
              placeholderTextColor={COLORS.muted}
              editable={!busy}
              className={INPUT_CLASS}
            />
            <Text className="text-muted text-xs mt-1.5 leading-5">
              Yalnızca bilgi: dolunca "Katılıyorum" kapanır ama gelen herkes derse girebilir.
            </Text>
          </Field>

          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-fg text-base">Programda göster</Text>
              <Text className="text-muted text-xs mt-0.5">Kapalıyken üyeler bu dersi görmez; silinmez.</Text>
            </View>
            <Switch
              value={draft.active}
              onValueChange={(v) => set({ active: v })}
              disabled={busy}
              trackColor={{ true: COLORS.accentFill }}
            />
          </View>

          <PrimaryButton
            label={existing ? 'Kaydet' : 'Ekle'}
            disabled={validation != null || busy || (existing != null && !dirty)}
            loading={busy}
            onPress={() => void save()}
          />
          {validation != null && dirty && <Text className="text-muted text-xs">{validation}</Text>}
          {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
        </Card>

        {existing && <DangerButton label="Dersi sil" icon={Trash2} disabled={busy} onPress={confirmDelete} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  count,
  max,
  className = '',
  children,
}: {
  label: string;
  count?: number;
  max?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <View className={className}>
      <View className="flex-row justify-between mb-2">
        <Text className="text-muted text-xs">{label}</Text>
        {count != null && max != null && (
          <Text className={`text-xs tabular-nums ${count > max ? 'text-danger' : 'text-muted'}`}>
            {count}/{max}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}
