import { useCallback, useEffect } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { eq } from 'drizzle-orm';
import { create } from 'zustand';

import { workoutSessions } from '@/db/schema';
import { useDb } from '@/hooks/useDb';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useSession } from '@/hooks/useSession';
import type { AccountError } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import {
  checkIn,
  checkOut,
  currentVisit,
  fetchOccupancy,
  fetchVisits,
  linkWorkoutToVisit,
  readOpenVisit,
  shouldLinkWorkout,
  visitState,
  visitsSince,
  writeOpenVisit,
  type Visit,
} from '@/lib/visits';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';

/**
 * Salon ziyaretleri (v3.6c) — salon başına ortak durum. Salon sekmesi,
 * Öğrencilerim, öğrenci ayrıntısı ve yönetici paneli aynı listeyi
 * kullanıyor: sunucu kime ne gösterileceğini belirliyor (üye kendi
 * ziyaretlerini, hoca aktif öğrencilerininkini, yönetici hepsini).
 *
 * Önbellek yok (ziyaret anlık bilgi); ekranlar odaklanınca yeniler.
 * Bayrak kapalıyken / giriş yokken / salon yokken hiçbir şey yapmaz.
 */
interface GymVisits {
  visits: Visit[];
  occupancy: number | null;
  loaded: boolean;
  loading: boolean;
  error: AccountError | null;
  loadedAt: number;
}

interface State {
  userId: string | null;
  byGym: Record<string, GymVisits>;
}

const EMPTY_GYM: GymVisits = { visits: [], occupancy: null, loaded: false, loading: false, error: null, loadedAt: 0 };

/** Salon sekmesi odaklanınca en fazla bu sıklıkta yeniler */
export const VISITS_STALE_MS = 60_000;

const useStore = create<State>(() => ({ userId: null, byGym: {} }));

function patchGym(gymId: string, patch: Partial<GymVisits>): void {
  useStore.setState((s) => ({ byGym: { ...s.byGym, [gymId]: { ...(s.byGym[gymId] ?? EMPTY_GYM), ...patch } } }));
}

async function load(userId: string, gymId: string): Promise<void> {
  if (useStore.getState().userId !== userId) useStore.setState({ userId, byGym: {} });
  patchGym(gymId, { loading: true });
  const client = getSupabase();
  const nowMs = Date.now();
  const [visits, occupancy] = await Promise.all([
    fetchVisits(client, { gymId, sinceIso: visitsSince(nowMs) }),
    fetchOccupancy(client, gymId),
  ]);
  if (useStore.getState().userId !== userId) return;
  if (!visits.ok) {
    patchGym(gymId, { loading: false, error: visits.error });
    return;
  }
  patchGym(gymId, {
    visits: visits.value,
    occupancy: occupancy.ok ? occupancy.value : null,
    loaded: true,
    loading: false,
    error: null,
    loadedAt: Date.now(),
  });
  // Cihazdaki açık ziyaret kaydı sunucuyla uyumlu kalsın (otomatik çıkış için)
  const open = currentVisit(visits.value, userId, gymId, Date.now());
  const record = await readOpenVisit(Storage, userId);
  if (open && record?.visitId !== open.id) {
    await writeOpenVisit(Storage, userId, { visitId: open.id, gymId, checkedInAt: open.checkedInAt });
  } else if (!open && record?.gymId === gymId) {
    await writeOpenVisit(Storage, userId, null);
  }
}

export function useGymVisits(gymId: string | null): GymVisits & {
  enabled: boolean;
  userId: string | null;
  refresh: () => Promise<void>;
  refreshIfStale: () => void;
} {
  const { available, userId, memberships } = useGymMembership();
  const enabled = available && userId != null && gymId != null && memberships.some((m) => m.gymId === gymId);
  const state = useStore();

  useEffect(() => {
    if (!available || !userId) {
      if (useStore.getState().userId != null) useStore.setState({ userId: null, byGym: {} });
    }
  }, [available, userId]);

  const refresh = useCallback(async () => {
    if (enabled && userId && gymId) await load(userId, gymId);
  }, [enabled, userId, gymId]);

  const refreshIfStale = useCallback(() => {
    if (!enabled || !userId || !gymId) return;
    const g = useStore.getState().byGym[gymId];
    if (useStore.getState().userId !== userId || !g || (!g.loading && Date.now() - g.loadedAt >= VISITS_STALE_MS)) {
      void load(userId, gymId);
    }
  }, [enabled, userId, gymId]);

  const current = enabled && state.userId === userId && gymId ? (state.byGym[gymId] ?? EMPTY_GYM) : EMPTY_GYM;
  return { ...current, enabled, userId, refresh, refreshIfStale };
}

/** QR ile giriş; başarıda açık ziyaret cihaza yazılır ve liste yenilenir */
export async function checkInToGym(
  userId: string,
  gymId: string,
  secret: string
): Promise<{ ok: true; reused: boolean } | { ok: false; error: AccountError }> {
  const result = await checkIn(getSupabase(), gymId, secret);
  if (!result.ok) return result;
  await writeOpenVisit(Storage, userId, { visitId: result.value.id, gymId, checkedInAt: result.value.checkedInAt });
  void load(userId, gymId);
  return { ok: true, reused: result.value.reused };
}

export async function checkOutOfGym(userId: string, visit: Visit): Promise<AccountError | null> {
  const result = await checkOut(getSupabase(), visit.id);
  if (!result.ok) return result.error;
  await writeOpenVisit(Storage, userId, null);
  await load(userId, visit.gymId);
  return null;
}

/**
 * Antrenman bitince otomatik çıkış (kök layout'ta bir kez). Store'a
 * dışarıdan abone: `active.tsx`'e dokunmadan, eşitlemedeki gibi.
 * Cihazda açık ziyaret varsa ve antrenman onun içinde bittiyse bitiş
 * saati çıkış olur. Bayrak kapalıyken / giriş yokken bağlanmaz.
 */
export function useVisitWorkoutLink(): void {
  const db = useDb();
  const { available, ready, userId } = useSession();

  useEffect(() => {
    if (!available || !ready || !userId) return;
    const unsubscribe = useActiveWorkoutStore.subscribe((state, prev) => {
      const sessionId = prev.activeSessionId;
      if (sessionId == null || state.activeSessionId != null) return;
      void (async () => {
        const record = await readOpenVisit(Storage, userId);
        if (!record) return;
        const nowMs = Date.now();
        // Süresi geçmiş kayıt: bağlanacak bir şey yok
        if (visitState({ checkedInAt: record.checkedInAt, checkedOutAt: null }, nowMs).kind === 'unknown') {
          await writeOpenVisit(Storage, userId, null);
          return;
        }
        const [session] = await db
          .select({ endedAt: workoutSessions.endedAt })
          .from(workoutSessions)
          .where(eq(workoutSessions.id, sessionId))
          .limit(1);
        // Vazgeçilen antrenman (satır yok / bitmemiş): ziyaret açık kalır
        if (!session?.endedAt) return;
        const endedAtMs = Date.parse(session.endedAt);
        if (!shouldLinkWorkout({ checkedInAt: record.checkedInAt, checkedOutAt: null }, endedAtMs, nowMs)) return;
        const result = await linkWorkoutToVisit(getSupabase(), record.visitId, sessionId, new Date(endedAtMs).toISOString());
        if (!result.ok) {
          console.warn('[VISITS] Antrenman ziyarete bağlanamadı:', result.error.kind);
          return;
        }
        await writeOpenVisit(Storage, userId, null);
        if (useStore.getState().byGym[record.gymId]) void load(userId, record.gymId);
      })().catch((e) => console.warn('[VISITS] Otomatik çıkış hatası:', e));
    });
    return unsubscribe;
  }, [available, ready, userId, db]);
}
