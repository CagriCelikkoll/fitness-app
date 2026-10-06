/**
 * Ana sayfadaki antrenman takvimi: son üç ay yan yana nokta ızgarası.
 * Sütunlar haftalar, satırlar Pazartesi → Pazar.
 *
 * Çizim View ile (~90 nokta). Dokunma: üç ay en fazla 18 sütun ediyor;
 * telefon genişliğinde hücre başına 32 px yer yok ve noktalara ayrı ayrı
 * genişletilmiş (hitSlop) alan verilse komşu alanlar üst üste binip yanlış
 * günü seçerdi. Bunun yerine her ayın ızgarası tek bir Pressable: basılan
 * koordinattan hücre hesaplanıyor, ızgarada ölü bölge kalmıyor ve seçilen
 * gün çerçeveyle gösteriliyor.
 */

import { useMemo, useState } from 'react';
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Card, ListRow } from '@/components/ui';
import { formatDuration, formatShortDate, toDateKey } from '@/lib/format';
import {
  calendarDayState,
  calendarMonths,
  groupSessionsByDay,
  type CalendarMonth,
} from '@/lib/workoutCalendar';
import { dateKeyToLocalDate } from '@/lib/weeklyVolume';

export interface CalendarSession {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
}

/** Aylar arası boşluk */
const MONTH_GAP = 12;
const MIN_CELL = 12;
const MAX_CELL = 22;

export function WorkoutCalendar({
  sessions,
  totalCount,
}: {
  sessions: CalendarSession[];
  totalCount: number;
}) {
  const router = useRouter();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const now = new Date();
  const todayKey = toDateKey(now);
  // Gün değişmedikçe ızgara yeniden hesaplanmasın
  const months = useMemo(() => calendarMonths(dateKeyToLocalDate(todayKey)), [todayKey]);
  const byDay = useMemo(() => groupSessionsByDay(sessions), [sessions]);
  const workoutDays = useMemo(() => new Set(byDay.keys()), [byDay]);

  const totalCols = months.reduce((n, m) => n + m.weeks.length, 0);
  const cell =
    width > 0
      ? Math.max(
          MIN_CELL,
          Math.min(
            MAX_CELL,
            Math.floor((width - MONTH_GAP * (months.length - 1)) / totalCols)
          )
        )
      : 0;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const handleSelect = (key: string) => {
    if (calendarDayState(key, todayKey, workoutDays) === 'future') return;
    setSelected((prev) => (prev === key ? null : key));
  };

  const selectedSessions = selected ? (byDay.get(selected) ?? []) : [];
  const selectedLabel = selected
    ? formatShortDate(dateKeyToLocalDate(selected).toISOString(), now)
    : '';

  return (
    <Card>
      <View className="flex-row items-baseline justify-between mb-4">
        <Text className="text-white text-lg font-semibold tracking-tight">
          Antrenman Takvimi
        </Text>
        <Text className="text-muted text-xs tabular-nums">
          Toplam {totalCount.toLocaleString('tr-TR')} antrenman
        </Text>
      </View>

      <View
        onLayout={onLayout}
        className="flex-row justify-center"
        style={{ gap: MONTH_GAP, minHeight: 7 * MIN_CELL + 20 }}
      >
        {cell > 0 &&
          months.map((month) => (
            <MonthGrid
              key={`${month.year}-${month.month}`}
              month={month}
              cell={cell}
              todayKey={todayKey}
              workoutDays={workoutDays}
              selected={selected}
              onSelect={handleSelect}
            />
          ))}
      </View>

      {selected != null && (
        <View className="mt-3 border-t border-border">
          {selectedSessions.length === 0 ? (
            <Text className="text-muted text-sm pt-3">
              {selectedLabel} · Antrenman yok
            </Text>
          ) : (
            selectedSessions.map((s, idx) => (
              <ListRow
                key={s.id}
                divider={idx > 0}
                chevron
                onPress={() =>
                  router.push({ pathname: '/session/[id]', params: { id: s.id } })
                }
              >
                <Text className="text-white text-sm" numberOfLines={1}>
                  {[
                    selectedLabel,
                    s.name,
                    s.durationSeconds ? formatDuration(s.durationSeconds) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </ListRow>
            ))
          )}
        </View>
      )}
    </Card>
  );
}

function MonthGrid({
  month,
  cell,
  todayKey,
  workoutDays,
  selected,
  onSelect,
}: {
  month: CalendarMonth;
  cell: number;
  todayKey: string;
  workoutDays: Set<string>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  // Basılan nokta → hücre. Çocuklar pointerEvents="none": locationX/Y
  // Android'de dokunulan alt görünüme göre geliyor, hedef hep bu kalsın.
  const handlePress = (e: GestureResponderEvent) => {
    const col = Math.floor(e.nativeEvent.locationX / cell);
    const row = Math.floor(e.nativeEvent.locationY / cell);
    const key = month.weeks[col]?.[row];
    if (key) onSelect(key);
  };

  return (
    <View>
      <Text className="text-muted text-xs mb-1.5">{month.label}</Text>
      <Pressable
        onPress={handlePress}
        hitSlop={{ top: 6, bottom: 6 }}
        accessibilityLabel={`${month.label} ayı antrenman takvimi`}
      >
        <View className="flex-row" pointerEvents="none">
          {month.weeks.map((week, w) => (
            <View key={w}>
              {week.map((key, d) => (
                <View
                  key={d}
                  style={{ width: cell, height: cell }}
                  className="items-center justify-center"
                >
                  {key != null && (
                    <Dot
                      state={calendarDayState(key, todayKey, workoutDays)}
                      today={key === todayKey}
                      selected={key === selected}
                      cell={cell}
                    />
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
      </Pressable>
    </View>
  );
}

const DOT_CLASS = {
  workout: 'bg-accent',
  rest: 'bg-border',
  future: 'bg-border opacity-30',
} as const;

function Dot({
  state,
  today,
  selected,
  cell,
}: {
  state: keyof typeof DOT_CLASS;
  today: boolean;
  selected: boolean;
  cell: number;
}) {
  const dot = cell >= 16 ? 8 : 6;
  const ring = Math.min(dot + 6, cell - 2);

  const inner = (
    <View
      style={{ width: dot, height: dot }}
      className={`rounded-full ${DOT_CLASS[state]}`}
    />
  );
  if (!today && !selected) return inner;

  // Seçili gün vurgu çerçevesi, bugün ince beyaz çerçeve
  return (
    <View
      style={{ width: ring, height: ring }}
      className={`rounded-full items-center justify-center border ${
        selected ? 'border-accent' : 'border-white/60'
      }`}
    >
      {inner}
    </View>
  );
}
