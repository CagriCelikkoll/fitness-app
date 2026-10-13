/**
 * Ders programı (v3.2c). Üstte haftanın günleri (Pzt–Paz, tarihleriyle),
 * altında seçili günün dersleri; önceki / sonraki hafta okları. Geçmiş
 * dersler soluk. Saatler salonun yerel saati (telefonun diliminden
 * bağımsız). İnternetsizken önbellekteki program ve "çevrimdışı" notu.
 *
 * Yönetici: "Programı düzenle" ve bir derse uzun basınca yalnızca o tarih
 * için iptal / değiştir / istisnayı kaldır. Ardından "Duyuru da
 * paylaşılsın mı?". Rol görünüm içindir; yetkiyi sunucu belirler.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { CalendarDays, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react-native';

import { useClassSchedule } from '@/hooks/useClassSchedule';
import { useGymMembership } from '@/hooks/useGymMembership';
import {
  INSTRUCTOR_MAX,
  NOTE_MAX,
  WEEKDAY_SHORT_TR,
  addDays,
  canChangeOccurrence,
  canEditSchedule,
  changeDraftError,
  changeDraftFor,
  changeRow,
  changeSummary,
  dayOfMonth,
  exceptionAnnouncement,
  formatDayLong,
  formatWeekRange,
  gymNow,
  isPast,
  occurrencesForDate,
  removeException,
  sanitizeTimeInput,
  scheduleForGym,
  setException,
  weekDays,
  weekStartOf,
  type ChangeDraft,
  type ClassException,
  type ClassOccurrence,
  type ClassSchedule,
} from '@/lib/classes';
import { getSupabase } from '@/lib/supabase';
import { Chip, DangerButton, EmptyState, PrimaryButton, SecondaryButton } from '@/components/ui';
import { COLORS } from '@/theme';

const INPUT_CLASS = 'bg-bg-elevated text-white text-base px-4 rounded-xl h-12';

export default function ClassesScreen() {
  const router = useRouter();
  const { available, userId, memberships, primary, refresh: refreshMemberships } = useGymMembership();
  const { templates, exceptions, loaded, loading, offline, error, refresh } = useClassSchedule();

  const [gymId, setGymId] = useState<string | null>(primary?.gymId ?? null);
  const today = gymNow(Date.now()).date;
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [selected, setSelected] = useState(today);
  const [action, setAction] = useState<ClassOccurrence | null>(null);

  // Üyelikler geç gelirse / salondan ayrıldıysa
  useEffect(() => {
    if (gymId == null || !memberships.some((m) => m.gymId === gymId)) setGymId(primary?.gymId ?? null);
  }, [gymId, memberships, primary]);

  useFocusEffect(
    useCallback(() => {
      if (!available || !userId) return;
      void refreshMemberships();
      void refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [available, userId])
  );

  if (!available || !userId) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Ders programı' }} />
        <Text className="text-muted text-base text-center">Ders programı için giriş yapman gerekiyor.</Text>
      </View>
    );
  }

  const schedule = gymId ? scheduleForGym({ templates, exceptions }, gymId) : { templates: [], exceptions: [] };
  const isAdmin = canEditSchedule(gymId, memberships);
  const nowMs = Date.now();
  const days = weekDays(weekStart);
  const items = occurrencesForDate(schedule, selected);

  const goWeek = (delta: number) => {
    const next = addDays(weekStart, delta * 7);
    setWeekStart(next);
    // Aynı gün adı yeni haftada; bu haftaya dönünce bugün
    setSelected(weekStartOf(today) === next ? today : addDays(selected, delta * 7));
  };

  const afterChange = async (occurrence: ClassOccurrence, next: ClassSchedule) => {
    setAction(null);
    await refresh();
    const updated = occurrencesForDate(next, occurrence.date).find((o) => o.key === occurrence.key);
    const text = updated ? exceptionAnnouncement(updated) : null;
    if (!text || !gymId) return;
    Alert.alert('Duyuru da paylaşılsın mı?', 'Üyeler duyurular ekranında ve ana sayfada görür.', [
      { text: 'Hayır', style: 'cancel' },
      {
        text: 'Duyuru yaz',
        onPress: () =>
          router.push({
            pathname: '/announcements/edit',
            params: { gymId, title: text.title, body: text.body },
          }),
      },
    ]);
  };

  /** Yeni istisnayla programın yerel hali (duyuru metni için) */
  const withException = (o: ClassOccurrence, ex: ClassException | null): ClassSchedule => ({
    templates: schedule.templates,
    exceptions: [...schedule.exceptions.filter((e) => !(e.templateId === o.templateId && e.date === o.date)), ...(ex ? [ex] : [])],
  });

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Ders programı' }} />
      <ScrollView
        contentContainerClassName="px-5 pt-4 pb-12 gap-3"
        refreshControl={
          <RefreshControl
            refreshing={loading && loaded}
            onRefresh={() => void refresh()}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
      >
        {memberships.length > 1 && (
          <View className="flex-row flex-wrap gap-2">
            {memberships.map((m) => (
              <Chip key={m.gymId} label={m.gymName} size="sm" active={m.gymId === gymId} onPress={() => setGymId(m.gymId)} />
            ))}
          </View>
        )}

        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => goWeek(-1)}
            hitSlop={10}
            accessibilityLabel="Önceki hafta"
            className="w-10 h-10 items-center justify-center rounded-full active:opacity-60"
          >
            <ChevronLeft color={COLORS.text} size={22} />
          </Pressable>
          <Pressable
            onPress={() => {
              setWeekStart(weekStartOf(today));
              setSelected(today);
            }}
            disabled={weekStart === weekStartOf(today)}
            className="items-center active:opacity-60"
          >
            <Text className="text-white text-base font-semibold">{formatWeekRange(weekStart)}</Text>
            {weekStart !== weekStartOf(today) && <Text className="text-accent text-xs mt-0.5">Bu haftaya dön</Text>}
          </Pressable>
          <Pressable
            onPress={() => goWeek(1)}
            hitSlop={10}
            accessibilityLabel="Sonraki hafta"
            className="w-10 h-10 items-center justify-center rounded-full active:opacity-60"
          >
            <ChevronRight color={COLORS.text} size={22} />
          </Pressable>
        </View>

        <View className="flex-row gap-1.5">
          {days.map((d, i) => {
            const active = d === selected;
            const hasClasses = occurrencesForDate(schedule, d).length > 0;
            return (
              <Pressable
                key={d}
                onPress={() => setSelected(d)}
                accessibilityLabel={formatDayLong(d)}
                className={`flex-1 items-center py-2 rounded-2xl active:opacity-70 ${
                  active ? 'bg-accent' : d === today ? 'bg-bg-surface border border-accent' : 'bg-bg-surface border border-border'
                }`}
              >
                <Text className={`text-xs ${active ? 'text-accent-fg' : 'text-muted'}`}>{WEEKDAY_SHORT_TR[i]}</Text>
                <Text className={`text-base font-semibold mt-0.5 ${active ? 'text-accent-fg' : 'text-white'}`}>
                  {dayOfMonth(d)}
                </Text>
                <View className={`w-1 h-1 rounded-full mt-1 ${hasClasses ? (active ? 'bg-accent-fg' : 'bg-accent') : ''}`} />
              </Pressable>
            );
          })}
        </View>

        {offline && <Text className="text-muted text-xs leading-5">Çevrimdışı · son çekilen program gösteriliyor</Text>}
        {error != null && <Text className="text-danger text-sm leading-5">{error.message}</Text>}

        <Text className="text-muted text-xs mt-1">{formatDayLong(selected)}</Text>

        {items.length === 0 ? (
          loaded && !loading ? (
            <EmptyState
              icon={CalendarDays}
              title={schedule.templates.length === 0 ? 'Henüz ders programı yok' : 'Bu gün ders yok'}
              description={
                schedule.templates.length === 0
                  ? isAdmin
                    ? '"Programı düzenle" ile haftalık dersleri ekle.'
                    : 'Salon programı eklediğinde burada görünecek.'
                  : 'Başka bir güne bak.'
              }
            />
          ) : null
        ) : (
          items.map((o) => (
            <OccurrenceCard
              key={o.key}
              occurrence={o}
              past={isPast(o, nowMs)}
              onLongPress={isAdmin && canChangeOccurrence(o, nowMs) ? () => setAction(o) : undefined}
            />
          ))
        )}

        {isAdmin && (
          <View className="gap-2 mt-3">
            <SecondaryButton
              label="Programı düzenle"
              icon={Settings2}
              onPress={() => gymId && router.push({ pathname: '/classes/templates', params: { gymId } })}
            />
            <Text className="text-muted text-xs leading-5">
              Yalnızca bir günü iptal etmek ya da değiştirmek için o derse uzun bas.
            </Text>
          </View>
        )}
      </ScrollView>

      <OccurrenceActions
        occurrence={action}
        onClose={() => setAction(null)}
        onDone={(o, ex) => void afterChange(o, withException(o, ex))}
        onRemoved={() => {
          setAction(null);
          void refresh();
        }}
      />
    </View>
  );
}

function OccurrenceCard({
  occurrence: o,
  past,
  onLongPress,
}: {
  occurrence: ClassOccurrence;
  past: boolean;
  onLongPress?: () => void;
}) {
  const cancelled = o.status === 'cancelled';
  const change = changeSummary(o);
  return (
    <Pressable
      onLongPress={onLongPress}
      disabled={!onLongPress}
      delayLongPress={400}
      className={`rounded-3xl p-5 bg-bg-surface border border-border flex-row gap-4 active:opacity-80 ${
        past || cancelled ? 'opacity-50' : ''
      }`}
    >
      <View className="w-14">
        <Text className={`text-white text-base font-semibold tabular-nums ${cancelled ? 'line-through' : ''}`}>
          {o.startTime}
        </Text>
        <Text className="text-muted text-xs tabular-nums mt-0.5">{o.endTime}</Text>
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className={`text-white text-base font-semibold flex-shrink ${cancelled ? 'line-through' : ''}`}>
            {o.name}
          </Text>
          {cancelled && (
            <View className="px-2 py-0.5 rounded-full bg-danger/20">
              <Text className="text-danger text-xs font-semibold">İptal</Text>
            </View>
          )}
        </View>
        <Text className="text-muted text-sm">{o.instructorName}</Text>
        {o.tagline != null && <Text className="text-muted text-xs italic">{o.tagline}</Text>}
        {change != null && <Text className="text-accent text-xs mt-1">{change}</Text>}
        {cancelled && o.note != null && <Text className="text-muted text-xs mt-1">{o.note}</Text>}
      </View>
    </Pressable>
  );
}

/**
 * Uzun basınca: tek Modal, içinde menü ↔ değişiklik formu (iç içe Modal
 * yok). Modal içinden yönlendirme yok; duyuru sorusu kapandıktan sonra.
 */
function OccurrenceActions({
  occurrence,
  onClose,
  onDone,
  onRemoved,
}: {
  occurrence: ClassOccurrence | null;
  onClose: () => void;
  onDone: (o: ClassOccurrence, ex: ClassException) => void;
  onRemoved: () => void;
}) {
  const [view, setView] = useState<'menu' | 'change'>('menu');
  const [draft, setDraft] = useState<ChangeDraft>({ startTime: '', instructorName: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!occurrence) return;
    setView('menu');
    setDraft(changeDraftFor(occurrence));
    setBusy(false);
    setError(null);
  }, [occurrence]);

  if (!occurrence) return null;
  const o = occurrence;

  const cancelClass = async () => {
    setBusy(true);
    setError(null);
    const r = await setException(getSupabase(), o, { kind: 'cancelled' });
    if (!r.ok) {
      setBusy(false);
      setError(r.error.message);
      return;
    }
    onDone(o, r.value);
  };

  const saveChange = async () => {
    if (changeDraftError(draft, o)) return;
    setBusy(true);
    setError(null);
    const r = await setException(getSupabase(), o, changeRow(draft, o));
    if (!r.ok) {
      setBusy(false);
      setError(r.error.message);
      return;
    }
    onDone(o, r.value);
  };

  const remove = async () => {
    if (!o.exception) return;
    setBusy(true);
    setError(null);
    const r = await removeException(getSupabase(), o.exception.id);
    if (!r.ok) {
      setBusy(false);
      setError(r.error.message);
      return;
    }
    onRemoved();
  };

  const validation = changeDraftError(draft, o);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={busy ? () => {} : onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <Pressable className="flex-1 bg-black/60 justify-end" onPress={busy ? undefined : onClose}>
          {/* İçerideki basışlar arka plana gidip modalı kapatmasın */}
          <Pressable onPress={() => {}} className="bg-bg-surface rounded-t-3xl px-5 pt-6 pb-10 gap-4 border-t border-border">
            <View>
              <Text className="text-white text-xl font-semibold tracking-tight">
                {o.originalStartTime} {o.name}
              </Text>
              <Text className="text-muted text-sm mt-1">{formatDayLong(o.date)} · yalnızca bu tarih</Text>
            </View>

            {view === 'menu' ? (
              <View className="gap-3">
                {o.status !== 'cancelled' && (
                  <DangerButton label="Bu dersi iptal et" loading={busy} disabled={busy} onPress={() => void cancelClass()} />
                )}
                <SecondaryButton label="Bu ders için değiştir" disabled={busy} onPress={() => setView('change')} />
                {o.exception && (
                  <SecondaryButton
                    label={o.status === 'cancelled' ? 'İptali geri al' : 'Değişikliği kaldır'}
                    disabled={busy}
                    onPress={() => void remove()}
                  />
                )}
                <Pressable onPress={onClose} disabled={busy} className="items-center py-2 active:opacity-60">
                  <Text className="text-muted text-sm">Vazgeç</Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-3">
                <Field label="Saat">
                  <TextInput
                    value={draft.startTime}
                    onChangeText={(t) => setDraft((d) => ({ ...d, startTime: sanitizeTimeInput(t) }))}
                    keyboardType="number-pad"
                    placeholder="19:30"
                    placeholderTextColor={COLORS.muted}
                    editable={!busy}
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Hoca" count={[...draft.instructorName.trim()].length} max={INSTRUCTOR_MAX}>
                  <TextInput
                    value={draft.instructorName}
                    onChangeText={(t) => setDraft((d) => ({ ...d, instructorName: t }))}
                    placeholderTextColor={COLORS.muted}
                    editable={!busy}
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Not (isteğe bağlı)" count={[...draft.note.trim()].length} max={NOTE_MAX}>
                  <TextInput
                    value={draft.note}
                    onChangeText={(t) => setDraft((d) => ({ ...d, note: t }))}
                    placeholder="Ör. Büyük salonda yapılacak"
                    placeholderTextColor={COLORS.muted}
                    editable={!busy}
                    className={INPUT_CLASS}
                  />
                </Field>
                {validation != null && <Text className="text-muted text-xs">{validation}</Text>}
                <PrimaryButton
                  label="Kaydet"
                  loading={busy}
                  disabled={validation != null || busy}
                  onPress={() => void saveChange()}
                />
                <Pressable onPress={() => setView('menu')} disabled={busy} className="items-center py-2 active:opacity-60">
                  <Text className="text-muted text-sm">Geri</Text>
                </Pressable>
              </View>
            )}

            {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  count,
  max,
  children,
}: {
  label: string;
  count?: number;
  max?: number;
  children: React.ReactNode;
}) {
  return (
    <View>
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
