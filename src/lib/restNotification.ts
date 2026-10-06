/**
 * Dinlenme bitiş bildirimi — saf mantık.
 *
 * Dinlenme sayacı `activeWorkoutStore`'da; bu dosya sayacın her
 * değişiminde (başlatma, +/-15, durdurma, antrenman bitişi) bildirimin
 * planlanmasına, yeniden planlanmasına ya da iptaline karar veriyor.
 * Sayacın kendi mantığına dokunmuyor, yalnızca değişimini dinliyor.
 *
 * expo-notifications çağrıları `RestNotificationApi` arkasında
 * (`restNative.ts`); burada Expo native modülü içe aktarılmıyor, testte
 * taklit api ve bellek içi depo kullanılıyor.
 *
 * Ayar ve "izin soruldu" bayrağı kv-store'da (şema değişikliği yok).
 */

import type { KeyValueStore } from '@/lib/onboarding';

// ============================================================================
// Ayar ve izin bayrağı (kv-store)
// ============================================================================

/** kv-store anahtarları. Değiştirme: mevcut cihazlarda değer kaybolur. */
export const REST_NOTIFICATION_ENABLED_KEY = 'restNotification.enabled';
export const REST_NOTIFICATION_ASKED_KEY = 'restNotification.permissionAsked';

/** Ayar hiç yazılmadıysa bildirim açık */
export const DEFAULT_REST_NOTIFICATION_ENABLED = true;

export function parseRestNotificationEnabled(raw: string | null): boolean {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return DEFAULT_REST_NOTIFICATION_ENABLED;
}

export async function getRestNotificationEnabled(
  store: KeyValueStore
): Promise<boolean> {
  return parseRestNotificationEnabled(
    await store.getItem(REST_NOTIFICATION_ENABLED_KEY)
  );
}

export async function setRestNotificationEnabled(
  store: KeyValueStore,
  enabled: boolean
): Promise<void> {
  await store.setItem(REST_NOTIFICATION_ENABLED_KEY, enabled ? '1' : '0');
}

export async function wasRestPermissionAsked(store: KeyValueStore): Promise<boolean> {
  return (await store.getItem(REST_NOTIFICATION_ASKED_KEY)) === '1';
}

// ============================================================================
// İzin
// ============================================================================

export interface NotificationPermissionApi {
  /** İzin şu an verilmiş mi (sormadan) */
  isGranted(): Promise<boolean>;
  /** Sistem izin penceresini açar; sonuç verildi mi */
  request(): Promise<boolean>;
}

/**
 * İzin verilmişse true. Verilmemişse yalnızca bir kez sorar: soruldu
 * bayrağı pencereden ÖNCE yazılıyor, reddeden ya da pencereyi kapatan
 * kullanıcıya bir daha sorulmuyor. Sonradan telefon ayarlarından izin
 * verilirse `isGranted` onu görür.
 */
export async function ensureRestNotificationPermission(
  api: NotificationPermissionApi,
  store: KeyValueStore
): Promise<boolean> {
  if (await api.isGranted()) return true;
  if (await wasRestPermissionAsked(store)) return false;
  await store.setItem(REST_NOTIFICATION_ASKED_KEY, '1');
  return api.request();
}

export type RestNotificationPermissionState = 'granted' | 'denied' | 'notAsked';

/** Ayarlar'da gösterilecek durum */
export function restNotificationPermissionState(
  granted: boolean,
  asked: boolean
): RestNotificationPermissionState {
  if (granted) return 'granted';
  return asked ? 'denied' : 'notAsked';
}

// ============================================================================
// Planlama kararı
// ============================================================================

/** `activeWorkoutStore` RestTimer şekli */
export interface RestTimerLike {
  startedAt: number;
  durationSeconds: number;
}

/**
 * Bitişine bundan az kalan sayaç için bildirim planlanmaz (ör. −15 ile
 * hemen biten sayaç): kullanıcı zaten ekranda, bildirim gecikip
 * sonradan düşerdi.
 */
export const MIN_NOTIFICATION_LEAD_MS = 1000;

export function restEndAtMs(timer: RestTimerLike): number {
  return timer.startedAt + timer.durationSeconds * 1000;
}

export type RestNotificationAction =
  | { kind: 'none' }
  | { kind: 'cancel' }
  | { kind: 'schedule'; fireAtMs: number };

/**
 * Sayaç `prev` → `next` değişince ne yapılacak.
 * - Sayaç değişmediyse hiçbir şey.
 * - Sayaç kalktıysa (durdurma, otomatik kapanma, antrenman bitişi) iptal.
 * - Ayar kapalıysa ya da bitişe çok az kaldıysa iptal (eskisi kalmasın).
 * - Yoksa yeni bitiş anına planla; eski bildirim yerine geçer.
 */
export function restNotificationAction(
  prev: RestTimerLike | null,
  next: RestTimerLike | null,
  { enabled, nowMs }: { enabled: boolean; nowMs: number }
): RestNotificationAction {
  if (
    prev === next ||
    (prev != null &&
      next != null &&
      prev.startedAt === next.startedAt &&
      prev.durationSeconds === next.durationSeconds)
  ) {
    return { kind: 'none' };
  }
  if (next == null || !enabled) return { kind: 'cancel' };

  const fireAtMs = restEndAtMs(next);
  if (fireAtMs - nowMs < MIN_NOTIFICATION_LEAD_MS) return { kind: 'cancel' };
  return { kind: 'schedule', fireAtMs };
}

export interface RestNotificationContent {
  title: string;
  body: string | null;
}

/** "Dinlenme bitti" + varsa süperset barındaki sıradaki bilgisi */
export function restNotificationContent(
  nextLabel: string | null
): RestNotificationContent {
  return { title: 'Dinlenme bitti', body: nextLabel };
}

// ============================================================================
// Planlayıcı
// ============================================================================

export interface RestNotificationApi extends NotificationPermissionApi {
  /** Planlar, bildirim kimliğini döner */
  schedule(fireAtMs: number, content: RestNotificationContent): Promise<string>;
  cancel(id: string): Promise<void>;
}

export interface RestNotificationScheduler {
  /**
   * Bir sonraki başlayacak dinlenmenin "Sıradaki" metni. Set tamamlanınca,
   * sayaç başlatılmadan önce çağrılıyor; yalnızca YENİ başlayan sayaca
   * bağlanır, +/-15 aynı metinle yeniden planlar.
   */
  setNextLabel(label: string | null): void;
  /** Store'daki sayaç değişince */
  onTimerChange(prev: RestTimerLike | null, next: RestTimerLike | null): Promise<void>;
  /** Planlanmış bildirimi kaldırır (ör. ayar kapatıldı) */
  cancel(): Promise<void>;
}

/**
 * İşlemler sıraya alınıyor: art arda +15/+15 ya da başlat/durdur
 * gelince bir önceki planlama bitmeden ikincisi başlamasın, eski
 * bildirim iptalsiz kalmasın.
 */
export function createRestNotificationScheduler(
  api: RestNotificationApi,
  deps: {
    store: KeyValueStore;
    now?: () => number;
    onError?: (err: unknown) => void;
  }
): RestNotificationScheduler {
  const now = deps.now ?? Date.now;
  let scheduledId: string | null = null;
  let pendingLabel: string | null = null;
  let timerLabel: string | null = null;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((err) => deps.onError?.(err));
    return queue;
  };

  const cancelCurrent = async () => {
    if (scheduledId == null) return;
    const id = scheduledId;
    scheduledId = null;
    await api.cancel(id);
  };

  return {
    setNextLabel(label) {
      pendingLabel = label;
    },

    onTimerChange(prev, next) {
      // Metin çağrı anında bağlanıyor, sıradaki iş beklerken değişmesin
      if (next != null && (prev == null || prev.startedAt !== next.startedAt)) {
        timerLabel = pendingLabel;
        pendingLabel = null;
      }
      const content = restNotificationContent(timerLabel);

      return enqueue(async () => {
        if (next == null) {
          await cancelCurrent();
          return;
        }
        const enabled = await getRestNotificationEnabled(deps.store);
        const action = restNotificationAction(prev, next, { enabled, nowMs: now() });
        if (action.kind === 'none') return;

        await cancelCurrent();
        if (action.kind === 'cancel') return;

        if (!(await ensureRestNotificationPermission(api, deps.store))) return;
        scheduledId = await api.schedule(action.fireAtMs, content);
      });
    },

    cancel() {
      return enqueue(cancelCurrent);
    },
  };
}

// ============================================================================
// Store bağlantısı
// ============================================================================

interface RestTimerStoreLike {
  subscribe(
    listener: (
      state: { restTimer: RestTimerLike | null },
      prev: { restTimer: RestTimerLike | null }
    ) => void
  ): () => void;
}

/**
 * Store'a dinleyici olarak bağlanır; store'un action'larına dokunmaz.
 * Dönen fonksiyon aboneliği kaldırır.
 */
export function connectRestNotifications(
  store: RestTimerStoreLike,
  scheduler: RestNotificationScheduler
): () => void {
  return store.subscribe((state, prev) => {
    if (state.restTimer !== prev.restTimer) {
      void scheduler.onTimerChange(prev.restTimer, state.restTimer);
    }
  });
}
