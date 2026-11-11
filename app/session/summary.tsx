/**
 * Antrenman özeti (v4.0a): antrenman bitince açılır (`active.tsx`
 * `finishSession` → `router.replace`). Seans zaten kaydedildi; "Kaydet ve
 * kapat" Antrenman sekmesine döner (önceki bitiş davranışı).
 *
 * Antrenman notu burada da yazılabilir; set düzenleme / silme ve hareket
 * dökümü mevcut ayrıntı ekranında (`/session/[id]`), "Ayrıntılar" ile.
 *
 * Route: /session/summary?id=<seans>&planned=<bitirmeden önceki set sayısı>
 * (statik route, dinamik `session/[id]`'ye tercih edilir).
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useScreenTopInset } from '@/hooks/useSafeBottom';
import { ChevronRight, Trophy } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useColors } from '@/hooks/useTheme';
import { formatDuration, formatRelativeDate } from '@/lib/format';
import { saveSessionNote } from '@/lib/notes';
import { loadSessionRecordPage, type RecordPageData } from '@/lib/recordEvents';
import { loadWorkoutSummary, plannedSetCount, recordText, type LoadedSummary } from '@/lib/workoutSummary';
import { DisplayName, Glow, ListRow, PrimaryButton, SectionLabel, StatCard } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { NoteEditor } from '@/components/NoteEditor';
import { RecordCelebration } from '@/components/RecordCelebration';

export default function WorkoutSummaryScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const db = useDb();
  const topInset = useScreenTopInset();
  const { id, planned } = useLocalSearchParams<{ id: string; planned?: string }>();
  const [summary, setSummary] = useState<LoadedSummary | null | undefined>(undefined);
  const [recordPage, setRecordPage] = useState<RecordPageData | null | undefined>(undefined);
  const [recordSeen, setRecordSeen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadWorkoutSummary(db, id!)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err) => {
        console.warn('[SUMMARY] Özet okunamadı:', err);
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  // Rekor sayfası okunamazsa antrenman özeti yine açılır
  useEffect(() => {
    let cancelled = false;
    loadSessionRecordPage(db, id!)
      .then((page) => {
        if (!cancelled) setRecordPage(page);
      })
      .catch((err) => {
        console.warn('[SUMMARY] Rekor okunamadı:', err);
        if (!cancelled) setRecordPage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  const close = () => router.replace('/(tabs)/workout');
  const showRecord = recordPage != null && !recordSeen;

  // Geri tuşu da "Kaydet ve kapat" gibi (aktif antrenman ekranı artık yok);
  // rekor sayfasındayken özete geçer, not ve ayrıntılar atlanmasın
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showRecord) setRecordSeen(true);
      else close();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecord]);

  if (summary === undefined || recordPage === undefined) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  if (showRecord) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <RecordCelebration page={recordPage} onContinue={() => setRecordSeen(true)} />
      </>
    );
  }

  const total = summary ? plannedSetCount(summary.completedSets, planned != null ? Number(planned) : null) : 0;
  const record = summary?.records[0];

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <Glow />
      <ScrollView
        contentContainerStyle={{ paddingTop: topInset + 64, flexGrow: 1 }}
        contentContainerClassName="px-4 pb-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-2 gap-3">
          <SectionLabel>Antrenman tamam</SectionLabel>
          {summary ? (
            <>
              <DisplayName accessibilityRole="header" inset={2 * (16 + 8)}>
                {summary.name}
              </DisplayName>
              <Text className="text-muted text-[15px]">
                {formatRelativeDate(summary.startedAt)}
                {summary.durationSeconds != null ? ` · ${formatDuration(summary.durationSeconds)}` : ''}
              </Text>
            </>
          ) : (
            <Text className="text-muted text-[15px]">Antrenman kaydedildi.</Text>
          )}
        </View>

        {summary && (
          <>
            <View className="flex-row gap-2.5 mt-7">
              <StatCard
                className="flex-1"
                label="Toplam hacim"
                value={Math.round(summary.volumeKg).toLocaleString('tr-TR')}
                unit="kg"
                selected
                accessibilityLabel={`Toplam hacim: ${Math.round(summary.volumeKg)} kilogram`}
              />
              <StatCard
                className="flex-1"
                label="Tamamlanan set"
                value={String(summary.completedSets)}
                unit={`/ ${total}`}
                accessibilityLabel={`Tamamlanan set: ${summary.completedSets} / ${total}`}
              />
            </View>

            {/* Rekor kartı: yalnızca bu antrenmanda rekor kırıldıysa */}
            {record && (
              <View
                accessible
                accessibilityLabel={`Yeni rekor: ${recordText(record)}`}
                className="mt-2.5 rounded-[20px] bg-bg-surface border border-border px-4 py-3.5 flex-row items-center gap-3.5"
              >
                <View className="w-11 h-11 rounded-[14px] bg-ctx-record items-center justify-center">
                  <Trophy color={COLORS.onContext} size={22} />
                </View>
                <View className="flex-1 gap-0.5">
                  <SectionLabel color="record">
                    {summary.records.length > 1 ? `Yeni rekor · ${summary.records.length}` : 'Yeni rekor'}
                  </SectionLabel>
                  <Text className="text-fg text-[15px] font-bold">{recordText(record)}</Text>
                  {summary.records.slice(1).map((r) => (
                    <Text key={r.exerciseName} className="text-muted text-sm">
                      {recordText(r)}
                    </Text>
                  ))}
                </View>
              </View>
            )}

            {/* Antrenman notu ("bugün nasıldı") */}
            <View className="mt-4 px-1">
              <NoteEditor
                key={id}
                initialValue={summary.notes}
                onSave={(text) => saveSessionNote(db, id!, text)}
                addLabel="Antrenman notu ekle"
                placeholder="Bugün nasıldı?"
              />
            </View>

            {/* Döküm, düzenleme ve silme: mevcut ayrıntı ekranı */}
            <View className="mt-2 rounded-[20px] bg-bg-surface border border-border px-4">
              <ListRow
                chevron
                onPress={() => router.push({ pathname: '/session/[id]', params: { id: id! } })}
                accessibilityRole="button"
              >
                <Text className="text-fg text-[15px] font-semibold">Ayrıntılar</Text>
                <Text className="text-muted text-xs mt-0.5">Hareketler, setler, silme</Text>
              </ListRow>
            </View>
          </>
        )}

        <View className="mt-auto pt-6">
          <PrimaryButton label="Kaydet ve kapat" icon={summary ? undefined : ChevronRight} onPress={close} />
        </View>
      </ScrollView>
    </View>
  );
}
