import { useEffect } from 'react';
import { AppState } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import { useSession } from '@/hooks/useSession';
import type { AccountError } from '@/lib/auth';
import {
  fetchSchedule,
  readScheduleCache,
  writeScheduleCache,
  type ClassException,
  type ClassOccurrence,
  type ClassTemplate,
} from '@/lib/classes';
import {
  EMPTY_ATTENDANCE,
  applyRsvp,
  fetchAttendance,
  joinClass,
  leaveClass,
  readAttendanceCache,
  writeAttendanceCache,
  type Attendance,
} from '@/lib/classRsvps';
import { myOccurrences } from '@/lib/classReminders';
import { classReminderSync, ensureClassReminderPermission } from '@/lib/classReminderNative';
import { getSupabase } from '@/lib/supabase';
import { createTriggerClock, type SyncTrigger } from '@/lib/sync/runner';

/**
 * Grup ders programı ve katılım (v3.2c) — ortak durum. Ana sayfadaki
 * "Bugün" kartı ve program ekranı aynı veriyi kullanıyor.
 *
 * Duyurularla aynı kurallar: önce önbellek (kv-store, kullanıcıya göre),
 * internetsizken o kalır ve "çevrimdışı"; yenileme girişte / açılışta,
 * öne gelince (en fazla 5 dk'da bir), ekran açılınca ve aşağı çekince.
 * Bayrak kapalıyken ya da giriş yokken hiçbir şey yapmaz.
 *
 * Her yenilemeden ve katıl / vazgeçten sonra ders hatırlatmaları
 * (yerel bildirim) yeniden eşleştirilir: vazgeçilen ya da iptal edilen
 * dersin bildirimi kalkar. Çıkışta hepsi kalkar.
 */

interface ScheduleState {
  userId: string | null;
  templates: ClassTemplate[];
  exceptions: ClassException[];
  attendance: Attendance;
  fetchedAt: string | null;
  loaded: boolean;
  loading: boolean;
  offline: boolean;
  error: AccountError | null;
  /** Katıl / vazgeç sürüyor (oturum anahtarları) */
  pending: string[];
}

const EMPTY: ScheduleState = {
  userId: null,
  templates: [],
  exceptions: [],
  attendance: EMPTY_ATTENDANCE,
  fetchedAt: null,
  loaded: false,
  loading: false,
  offline: false,
  error: null,
  pending: [],
};

const useStore = create<ScheduleState>(() => EMPTY);
const clock = createTriggerClock();

/** Katıldığım derslerin hatırlatmalarını telefona yansıt */
function syncReminders(): Promise<void> {
  const s = useStore.getState();
  if (!s.userId || !s.loaded) return Promise.resolve();
  return classReminderSync.sync(myOccurrences(s, s.attendance.mine));
}

/** Ayarlar'daki bildirim anahtarı değişince (giriş yoksa hiçbir şey yapmaz) */
export function resyncClassReminders(): void {
  void syncReminders();
}

async function loadCache(userId: string): Promise<void> {
  if (useStore.getState().userId === userId && useStore.getState().loaded) return;
  useStore.setState({ ...EMPTY, userId });
  const [cache, attendance] = await Promise.all([
    readScheduleCache(Storage, userId),
    readAttendanceCache(Storage, userId),
  ]);
  if (useStore.getState().userId !== userId) return;
  useStore.setState({
    templates: cache?.templates ?? [],
    exceptions: cache?.exceptions ?? [],
    attendance: attendance ?? EMPTY_ATTENDANCE,
    fetchedAt: cache?.fetchedAt ?? null,
    loaded: true,
  });
}

async function refresh(userId: string): Promise<void> {
  await loadCache(userId);
  if (useStore.getState().userId !== userId) return;
  useStore.setState({ loading: true });
  const client = getSupabase();
  const [result, attendance] = await Promise.all([fetchSchedule(client), fetchAttendance(client, userId)]);
  if (useStore.getState().userId !== userId) return; // bu arada çıkış / başka hesap
  const failed = !result.ok ? result.error : !attendance.ok ? attendance.error : null;
  if (failed || !result.ok || !attendance.ok) {
    useStore.setState({
      loading: false,
      offline: failed?.kind === 'network',
      error: failed?.kind === 'network' ? null : failed,
    });
    return;
  }
  const fetchedAt = new Date().toISOString();
  useStore.setState({
    ...result.value,
    // Bu arada başlayan katıl / vazgeç yanıtı ezilmesin: bekleyen varsa yerel hal kalır
    attendance: useStore.getState().pending.length > 0 ? useStore.getState().attendance : attendance.value,
    fetchedAt,
    loading: false,
    offline: false,
    error: null,
  });
  void syncReminders();
  writeScheduleCache(Storage, userId, { fetchedAt, ...result.value }).catch((err) =>
    console.warn('[CLASSES] Önbellek yazılamadı:', err)
  );
  writeAttendanceCache(Storage, userId, attendance.value).catch((err) =>
    console.warn('[CLASSES] Katılım önbelleği yazılamadı:', err)
  );
}

async function setRsvp(userId: string, o: ClassOccurrence, join: boolean): Promise<AccountError | null> {
  const s = useStore.getState();
  if (s.userId !== userId || s.pending.includes(o.key)) return null;
  const before = s.attendance;
  useStore.setState({
    attendance: applyRsvp(before, o.key, userId, join),
    pending: [...s.pending, o.key],
  });
  // İlk katılımda bir kez bildirim izni (sorulduysa sormaz)
  if (join) await ensureClassReminderPermission();
  const client = getSupabase();
  const result = join ? await joinClass(client, o) : await leaveClass(client, o, userId);
  if (useStore.getState().userId !== userId) return null;
  const pending = useStore.getState().pending.filter((k) => k !== o.key);
  if (!result.ok) {
    useStore.setState({ attendance: applyRsvp(useStore.getState().attendance, o.key, userId, !join), pending });
    return result.error;
  }
  useStore.setState({ pending });
  void syncReminders();
  writeAttendanceCache(Storage, userId, useStore.getState().attendance).catch(() => {});
  // Sayılar başkalarıyla birlikte değişmiş olabilir
  void refresh(userId);
  return null;
}

function trigger(kind: SyncTrigger): void {
  const userId = useStore.getState().userId;
  if (!userId) return;
  if (!clock.take(kind, Date.now())) return;
  void refresh(userId);
}

/** Kök layout'ta bir kez: açılış / giriş ve öne gelme (5 dk) */
export function useClassScheduleTriggers(): void {
  const { available, ready, userId } = useSession();

  useEffect(() => {
    if (!available || !ready || !userId) {
      if (useStore.getState().userId != null) {
        useStore.setState(EMPTY);
        // Çıkış: bu hesabın ders hatırlatmaları kalksın
        void classReminderSync.sync([]);
      }
      return;
    }
    useStore.setState((s) => (s.userId === userId ? s : { ...EMPTY, userId }));
    trigger('login');
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') trigger('foreground');
    });
    return () => {
      sub.remove();
      clock.reset();
    };
  }, [available, ready, userId]);
}

export function useClassSchedule(): ScheduleState & {
  /** Ekran açılınca / aşağı çekince / düzenlemeden sonra (5 dk kuralı yok) */
  refresh: () => Promise<void>;
  /** "Katılıyorum" / "Vazgeç"; hata varsa döner */
  setRsvp: (o: ClassOccurrence, join: boolean) => Promise<AccountError | null>;
} {
  const { available, userId } = useSession();
  const state = useStore();
  const current = available && userId != null && state.userId === userId;

  useEffect(() => {
    if (available && userId) void loadCache(userId);
  }, [available, userId]);

  return {
    ...(current ? state : { ...EMPTY, userId }),
    refresh: async () => {
      if (available && userId) await refresh(userId);
    },
    setRsvp: async (o, join) => (available && userId ? setRsvp(userId, o, join) : null),
  };
}
