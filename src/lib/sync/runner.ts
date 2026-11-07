/**
 * Eşitlemenin ne zaman çalışacağı (v3.1b) — saf karar, React yok.
 * Bağlantı: src/hooks/useSyncTriggers.ts.
 *
 * Yalnızca env tanımlı + giriş yapılmış iken (v3.7'den beri gizli bayrak
 * yok; hesap herkese açık); değilse motor hiç çağrılmıyor, istemci
 * kurulmuyor, ağa istek gitmiyor, takip açılmıyor.
 * Sahip uyuşmazlığını motor kendisi denetliyor (istek atmadan).
 */

import type { Db } from '@/db/client';

import { runSync, type SyncOutcome } from './engine';
import type { SyncTransport } from './types';

export type SyncTrigger = 'login' | 'foreground' | 'workout_finished' | 'manual';

/** Uygulama öne gelince en fazla bu sıklıkta */
export const FOREGROUND_MIN_INTERVAL_MS = 5 * 60_000;

/** Öne gelme kısıtlı; giriş, antrenman bitişi ve "Şimdi eşitle" değil */
export function shouldRun(trigger: SyncTrigger, lastAttemptAt: number | null, nowMs: number): boolean {
  if (trigger !== 'foreground') return true;
  return lastAttemptAt == null || nowMs - lastAttemptAt >= FOREGROUND_MIN_INTERVAL_MS;
}

export type GatedOutcome = SyncOutcome | { status: 'disabled' } | { status: 'skipped' };

export interface SyncGate {
  /** Env tanımlı (v3.7 öncesi: gizli bayrak da açık) */
  enabled: boolean;
  userId: string | null;
  db: Db;
  /** Yalnızca gerektiğinde çağrılır (giriş yokken asla) */
  makeTransport: () => SyncTransport | null;
  confirmDeletes?: boolean;
}

export async function syncIfEnabled(gate: SyncGate): Promise<GatedOutcome> {
  if (!gate.enabled || !gate.userId) return { status: 'disabled' };
  const transport = gate.makeTransport();
  if (!transport) return { status: 'disabled' };
  return runSync({
    db: gate.db,
    transport,
    userId: gate.userId,
    confirmDeletes: gate.confirmDeletes,
  });
}

/** Tetikleyici sayacı: öne gelme kısıtı için son deneme zamanı */
export function createTriggerClock() {
  let lastAttemptAt: number | null = null;
  return {
    /** Tetik çalışmalıysa son deneme zamanını işaretleyip true döner */
    take(trigger: SyncTrigger, nowMs: number): boolean {
      if (!shouldRun(trigger, lastAttemptAt, nowMs)) return false;
      lastAttemptAt = nowMs;
      return true;
    },
    reset() {
      lastAttemptAt = null;
    },
  };
}

