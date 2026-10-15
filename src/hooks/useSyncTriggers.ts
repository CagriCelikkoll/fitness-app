import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import type { Db } from '@/db/client';
import { useDb } from '@/hooks/useDb';
import { useSession } from '@/hooks/useSession';
import { getSupabase } from '@/lib/supabase';
import {
  getSyncStatus,
  keepLocalCopies,
  restoreDeletedFromCloud,
  type SyncIssue,
  type SyncStatus,
} from '@/lib/sync/engine';
import { createTriggerClock, syncIfEnabled, type SyncTrigger } from '@/lib/sync/runner';
import { supabaseTransport } from '@/lib/sync/supabaseTransport';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';

/**
 * Eşitleme tetikleyicileri (v3.1b). `app/_layout.tsx`'te bir kez bağlanır.
 *
 * Yalnızca gizli bayrak açık + giriş yapılmış iken (`useSession`
 * bayrak kapalıyken `available: false` döner, istemciye dokunmaz):
 * - girişten hemen sonra / açılışta oturum varsa
 * - antrenman bitince: store'a dışarıdan abone (`active.tsx`'e dokunmadan);
 *   `endSession` veritabanı yazıldıktan sonra çağrılıyor
 * - uygulama öne gelince, en fazla 5 dakikada bir
 * - Ayarlar'daki "Şimdi eşitle" (`requestSync`)
 *
 * Sahip uyuşmazlığı ve silme korumaları motorda (src/lib/sync/engine.ts);
 * kullanıcının cevabı `resolveDeleteConfirmation` ile (v3.1c).
 */

interface SyncUiState {
  status: SyncStatus | null;
  running: boolean;
}

const useSyncStore = create<SyncUiState>(() => ({ status: null, running: false }));

const clock = createTriggerClock();
let context: { db: Db; userId: string } | null = null;

async function refreshStatus(db: Db): Promise<void> {
  try {
    useSyncStore.setState({ status: await getSyncStatus(db) });
  } catch (err) {
    console.warn('[SYNC] Durum okunamadı:', err);
  }
}

async function trigger(kind: SyncTrigger, options: { confirmDeletes?: boolean } = {}): Promise<void> {
  const ctx = context;
  if (!ctx) return;
  if (!clock.take(kind, Date.now())) return;
  useSyncStore.setState({ running: true });
  try {
    await syncIfEnabled({
      enabled: true,
      userId: ctx.userId,
      db: ctx.db,
      confirmDeletes: options.confirmDeletes,
      makeTransport: () => {
        const client = getSupabase();
        return client ? supabaseTransport(client) : null;
      },
    });
  } finally {
    useSyncStore.setState({ running: false });
    await refreshStatus(ctx.db);
  }
}

/** "Şimdi eşitle" / "Tekrar dene" */
export function requestSync(): Promise<void> {
  return trigger('manual');
}

/**
 * 50+ silme sorusunun cevabı (v3.1c, 3.2).
 * - keep (öne çıkan, veriyi koruyan):
 *   gönderme yönü → silinenler buluttan geri getirilir;
 *   çekme yönü → bu telefondakiler buluta yeniden gönderilir.
 * - drop: silme bir kez onaylanarak uygulanır.
 */
export async function resolveDeleteConfirmation(
  issue: Extract<SyncIssue, { kind: 'needs_confirmation' }>,
  choice: 'keep' | 'drop'
): Promise<void> {
  const ctx = context;
  if (!ctx) return;
  if (choice === 'drop') return trigger('manual', { confirmDeletes: true });
  if (issue.direction === 'push') {
    await restoreDeletedFromCloud(ctx.db);
  } else {
    await keepLocalCopies(ctx.db, issue.ids ?? { sessions: [], routines: [] });
  }
  return trigger('manual');
}

export function useSyncTriggers(): void {
  const db = useDb();
  const { available, ready, userId } = useSession();

  useEffect(() => {
    if (!available || !ready || !userId) return;
    context = { db, userId };
    void refreshStatus(db);
    void trigger('login');

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void trigger('foreground');
    });
    const unsubscribe = useActiveWorkoutStore.subscribe((state, prev) => {
      if (prev.activeSessionId != null && state.activeSessionId == null) {
        void trigger('workout_finished');
      }
    });

    return () => {
      appState.remove();
      unsubscribe();
      context = null;
      clock.reset();
    };
  }, [available, ready, userId, db]);
}

/** Ayarlar'daki eşitleme kartı için */
export function useSyncStatus(): SyncUiState & { refresh: () => Promise<void> } {
  const db = useDb();
  const state = useSyncStore();
  useEffect(() => {
    void refreshStatus(db);
  }, [db]);
  return { ...state, refresh: () => refreshStatus(db) };
}

/**
 * Eşitleme açık mı (3.3 uyarıları için): bayrak açık, giriş yapılmış ve
 * bu telefonda takip başlamış.
 */
export function useSyncActive(): boolean {
  const { available, userId } = useSession();
  const { status } = useSyncStatus();
  return available && userId != null && status?.tracking === true;
}
