import { useCallback, useEffect } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import type { Db } from '@/db/client';
import type { AccountError } from '@/lib/auth';
import { canViewMembers } from '@/lib/gymAdmin';
import { addProgramRoutines, routineIdSet, updateProgramRoutines } from '@/lib/programRoutines';
import {
  dismissUpdate,
  fetchAssignments,
  fetchPrograms,
  pruneLinks,
  readProgramCache,
  readRoutineLinks,
  replaceProgramLinks,
  writeProgramCache,
  writeRoutineLinks,
  type GymProgram,
  type ProgramAssignment,
  type ProgramPayload,
  type ProgramRoutineLink,
  type RoutinePlan,
} from '@/lib/programs';
import { getSupabase } from '@/lib/supabase';
import { useGymMembership } from '@/hooks/useGymMembership';

/**
 * Programlar (v3.6b) — ortak durum. Programlar ekranı, ayrıntı, hocanın
 * ekranları ve rutin listesindeki "güncellendi" rozeti aynı listeyi
 * kullanıyor.
 *
 * Önce önbellek (kv-store, kullanıcıya göre): internetsizken son çekilen
 * liste kalır ve "çevrimdışı". Ekranlar odaklanınca yeniler; rutin
 * listesi yalnızca programdan rutin eklenmişse ve liste eskiyse.
 * Hoca / yönetici için açık atamalar da çekilir. Bayrak kapalıyken / giriş
 * yokken / salona üye değilken hiçbir şey yapmaz.
 *
 * Rutin ↔ program bağları cihaza ait (kullanıcıdan bağımsız) ayrı bir
 * kayıt (`programs.routineLinks`).
 */
interface State {
  userId: string | null;
  programs: GymProgram[];
  assignments: ProgramAssignment[];
  fetchedAt: string | null;
  loaded: boolean;
  loading: boolean;
  offline: boolean;
  error: AccountError | null;
  /** Son başarılı yenileme (ms) */
  refreshedAt: number;
}

const EMPTY: State = {
  userId: null,
  programs: [],
  assignments: [],
  fetchedAt: null,
  loaded: false,
  loading: false,
  offline: false,
  error: null,
  refreshedAt: 0,
};

/** Rutin listesi odaklanınca en fazla bu sıklıkta yeniler */
export const PROGRAMS_STALE_MS = 5 * 60_000;

const useStore = create<State>(() => EMPTY);

async function loadCache(userId: string): Promise<void> {
  if (useStore.getState().userId === userId && useStore.getState().loaded) return;
  useStore.setState({ ...EMPTY, userId });
  const cache = await readProgramCache(Storage, userId);
  if (useStore.getState().userId !== userId) return;
  useStore.setState({ programs: cache?.programs ?? [], fetchedAt: cache?.fetchedAt ?? null, loaded: true });
}

async function refresh(userId: string, staff: boolean): Promise<void> {
  await loadCache(userId);
  if (useStore.getState().userId !== userId) return;
  useStore.setState({ loading: true });
  const client = getSupabase();
  const [result, assignments] = await Promise.all([
    fetchPrograms(client),
    staff ? fetchAssignments(client) : Promise.resolve(null),
  ]);
  if (useStore.getState().userId !== userId) return; // bu arada çıkış / başka hesap
  const failed = !result.ok ? result.error : assignments && !assignments.ok ? assignments.error : null;
  if (failed || !result.ok) {
    useStore.setState({
      loading: false,
      offline: failed?.kind === 'network',
      error: failed?.kind === 'network' ? null : failed,
    });
    return;
  }
  const fetchedAt = new Date().toISOString();
  useStore.setState({
    programs: result.value.programs,
    assignments: assignments?.ok ? assignments.value : [],
    fetchedAt,
    loading: false,
    offline: false,
    error: null,
    refreshedAt: Date.now(),
  });
  writeProgramCache(Storage, userId, fetchedAt, result.value.rows).catch((e) =>
    console.warn('[PROGRAMS] Önbellek yazılamadı:', e)
  );
}

export function usePrograms(): State & {
  /** Salona üye ve bayrak açık: programlar görünür */
  enabled: boolean;
  refresh: () => Promise<void>;
  /** Son yenilemeden bu yana `PROGRAMS_STALE_MS` geçtiyse yenile */
  refreshIfStale: () => void;
} {
  const { available, userId, memberships } = useGymMembership();
  const enabled = available && userId != null && memberships.length > 0;
  const staff = memberships.some((m) => canViewMembers(m.gymId, memberships));
  const state = useStore();

  useEffect(() => {
    if (!enabled || !userId) {
      if (useStore.getState().userId != null) useStore.setState(EMPTY);
      return;
    }
    void loadCache(userId);
  }, [enabled, userId]);

  const doRefresh = useCallback(async () => {
    if (enabled && userId) await refresh(userId, staff);
  }, [enabled, userId, staff]);

  const refreshIfStale = useCallback(() => {
    const s = useStore.getState();
    if (!enabled || !userId || s.loading) return;
    if (s.userId !== userId || Date.now() - s.refreshedAt >= PROGRAMS_STALE_MS) void refresh(userId, staff);
  }, [enabled, userId, staff]);

  const current = enabled && state.userId === userId;
  return {
    ...(current ? state : { ...EMPTY, userId }),
    enabled,
    refresh: doRefresh,
    refreshIfStale,
  };
}

// ============================================================================
// Rutin ↔ program bağları
// ============================================================================

interface LinkState {
  links: ProgramRoutineLink[];
  loaded: boolean;
}

const useLinkStore = create<LinkState>(() => ({ links: [], loaded: false }));

async function loadLinks(): Promise<void> {
  if (useLinkStore.getState().loaded) return;
  const links = await readRoutineLinks(Storage);
  useLinkStore.setState({ links, loaded: true });
}

/** Bağları kaydet (ekranlar aynı anda görsün) */
export async function saveRoutineLinks(links: ProgramRoutineLink[]): Promise<void> {
  useLinkStore.setState({ links, loaded: true });
  await writeRoutineLinks(Storage, links);
}

export function useRoutineLinks(enabled: boolean): LinkState {
  const state = useLinkStore();
  useEffect(() => {
    if (enabled) void loadLinks();
  }, [enabled]);
  return enabled ? state : { links: [], loaded: false };
}

/** Kaydetmeden önce en güncel bağlar (kv'den okunmamışsa okur) */
export async function currentRoutineLinks(): Promise<ProgramRoutineLink[]> {
  await loadLinks();
  return useLinkStore.getState().links;
}

// ============================================================================
// Rutin işlemleri (program ayrıntısı ve rutin listesi)
// ============================================================================

type ReadyProgram = GymProgram & { payload: ProgramPayload };

/** Cihazdaki bağlar, silinmiş rutinler düşürülmüş */
async function liveLinks(db: Db): Promise<ProgramRoutineLink[]> {
  return pruneLinks(await currentRoutineLinks(), await routineIdSet(db));
}

/** "Rutinlerime ekle": rutinleri oluşturur, bağları kaydeder */
export async function addProgramToRoutines(db: Db, program: ReadyProgram): Promise<{ count: number; plan: RoutinePlan }> {
  const result = await addProgramRoutines(db, program);
  await saveRoutineLinks([...(await liveLinks(db)), ...result.links]);
  return { count: result.links.length, plan: result.plan };
}

/** "Güncelle": bağlı rutinleri programın yeni haline getirir */
export async function applyProgramUpdate(db: Db, program: ReadyProgram): Promise<RoutinePlan> {
  const all = await liveLinks(db);
  const result = await updateProgramRoutines(db, program, all);
  await saveRoutineLinks(replaceProgramLinks(all, program.id, result.links));
  return result.plan;
}

/** "Böyle kalsın": rutinler aynı kalır, bu sürüm için rozet kalkar */
export async function keepProgramRoutines(programId: string, version: number): Promise<void> {
  await saveRoutineLinks(dismissUpdate(await currentRoutineLinks(), programId, version));
}
