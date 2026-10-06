/**
 * Dinlenme bildirimi ve sesinin Expo native katmanı (ince).
 *
 * Kararlar `restNotification.ts` ve `restSound.ts`'te; burada yalnızca
 * expo-notifications / expo-audio çağrıları var. `id.ts` ve
 * `backupFile.ts` gibi native modül içe aktaran istisnalardan; testlerde
 * içe aktarılmıyor.
 */

import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import Storage from 'expo-sqlite/kv-store';

import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import {
  connectRestNotifications,
  createRestNotificationScheduler,
  restNotificationPermissionState,
  wasRestPermissionAsked,
  type RestNotificationApi,
  type RestNotificationPermissionState,
} from '@/lib/restNotification';

/** Android bildirim kanalı. Kimliği değiştirme: kullanıcı ayarları kanala bağlı. */
const REST_CHANNEL_ID = 'rest';

let channelReady: Promise<void> | null = null;

/**
 * Android 8+ kanalı. Android 13+'te izin penceresi de ancak bir kanal
 * varken açılıyor; izin istemeden önce de çağrılıyor. Android 9'da
 * çalışma zamanı izni yok, kanal yine gerekli.
 */
function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(REST_CHANNEL_ID, {
    name: 'Dinlenme',
    description: 'Telefon kilitliyken dinlenme bitince haber verir',
    importance: Notifications.AndroidImportance.HIGH,
    enableVibrate: true,
    vibrationPattern: [0, 400, 200, 400],
  })
    .then(() => undefined)
    .catch((err) => {
      channelReady = null;
      throw err;
    });
  return channelReady;
}

const api: RestNotificationApi = {
  async isGranted() {
    return (await Notifications.getPermissionsAsync()).granted;
  },
  async request() {
    await ensureChannel();
    return (await Notifications.requestPermissionsAsync()).granted;
  },
  async schedule(fireAtMs, content) {
    await ensureChannel();
    return Notifications.scheduleNotificationAsync({
      content: {
        title: content.title,
        ...(content.body != null ? { body: content.body } : {}),
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAtMs,
        channelId: REST_CHANNEL_ID,
      },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
};

export const restNotificationScheduler = createRestNotificationScheduler(api, {
  store: Storage,
  onError: (err) => console.error('[REST-NOTIFICATION] HATA:', err),
});

let installed = false;

/**
 * Uygulama açılışında bir kez çağrılır (`app/_layout.tsx`). İzin
 * istemiyor; izin ilk dinlenme başlarken soruluyor.
 */
export function installRestNotifications(): void {
  if (installed) return;
  installed = true;

  // Ön planda gösterme: ekranda zaten sayaç, titreşim ve ses var
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  connectRestNotifications(useActiveWorkoutStore, restNotificationScheduler);
}

/** Ayarlar'daki durum satırı için */
export async function getRestNotificationPermissionState(): Promise<RestNotificationPermissionState> {
  const [granted, asked] = await Promise.all([
    api.isGranted(),
    wasRestPermissionAsked(Storage),
  ]);
  return restNotificationPermissionState(granted, asked);
}

/** Reddedilmiş izin için uygulamanın sistem ayarları sayfası */
export function openNotificationSettings(): void {
  void Linking.openSettings();
}

// ============================================================================
// Ses
// ============================================================================

let playerReady: Promise<AudioPlayer> | null = null;

/**
 * Oynatıcı ilk kullanımda bir kez kuruluyor; ses modu oynatıcıdan önce
 * ayarlanıyor ki ilk bip de sessiz moda uysun.
 *
 * - `playsInSilentMode: false`: iPhone sessiz anahtarı açıkken çalmaz
 *   (Android'de zil sessiz/titreşimdeyken de).
 * - `mixWithOthers`: kulaklıktaki müzik durmaz, ses üstüne karışır.
 */
function getPlayer(): Promise<AudioPlayer> {
  playerReady ??= setAudioModeAsync({
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers',
  })
    .catch((err) => console.error('[REST-SOUND] Ses modu:', err))
    .then(() => createAudioPlayer(require('../../assets/sounds/rest-done.wav')))
    .catch((err) => {
      playerReady = null;
      throw err;
    });
  return playerReady;
}

/** Dinlenme başlarken çağrılıyor; bitişte ilk bip gecikmesin */
export function preloadRestDoneSound(): void {
  getPlayer().catch((err) => console.error('[REST-SOUND] HATA:', err));
}

export function playRestDoneSound(): void {
  getPlayer()
    .then(async (p) => {
      await p.seekTo(0);
      p.play();
    })
    .catch((err) => console.error('[REST-SOUND] HATA:', err));
}
