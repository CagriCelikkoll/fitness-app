/**
 * Push bildirimin Expo native katmanı (v3.3, ince). Kararlar `push.ts`'te.
 * `restNative.ts` gibi native modül içe aktaran istisnalardan; testlerde
 * içe aktarılmıyor.
 *
 * Bayrak kapalıyken / giriş yokken / salon üyeliği yokken hiçbir şey
 * yapmaz: izin istemez, token almaz, ağa çıkmaz.
 */

import { useEffect, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import { useGymMembership } from '@/hooks/useGymMembership';
import { getSupabase } from '@/lib/supabase';
import {
  PUSH_CHANNELS,
  PUSH_PERMISSION_TEXT,
  createPushRegistrar,
  pushTarget,
  shouldExplainPushPermission,
  type PushDeviceApi,
} from '@/lib/push';
import { ensureRestNotificationPermission, wasRestPermissionAsked } from '@/lib/restNotification';

let channelsReady: Promise<void> | null = null;

function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelsReady ??= Promise.all(
    PUSH_CHANNELS.map((c) =>
      Notifications.setNotificationChannelAsync(c.id, {
        name: c.name,
        description: c.description,
        importance: Notifications.AndroidImportance.HIGH,
      })
    )
  )
    .then(() => undefined)
    .catch((err) => {
      channelsReady = null;
      throw err;
    });
  return channelsReady;
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

const api: PushDeviceApi = {
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  async isGranted() {
    return (await Notifications.getPermissionsAsync()).granted;
  },
  ensureChannels,
  async getToken() {
    return (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
  },
};

export const pushRegistrar = createPushRegistrar(api, Storage, {
  onError: (err) => console.warn('[PUSH] Kayıt:', err),
});

/**
 * Token kaydı (`app/_layout.tsx`). Salon üyesi bir kullanıcı için:
 * açılışta, uygulama öne gelince (izin sonradan verilmiş olabilir) ve
 * Expo token'ı değişince. Telefondaki kayıt tazeyse ağa çıkmaz.
 */
export function usePushRegistration(): void {
  const { available, userId, memberships } = useGymMembership();
  const active = available && userId != null && memberships.length > 0;

  useEffect(() => {
    if (!active || !userId) return;
    void pushRegistrar.register(getSupabase(), userId);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pushRegistrar.register(getSupabase(), userId);
    });
    const tokenSub = Notifications.addPushTokenListener(() => {
      void pushRegistrar.register(getSupabase(), userId, { force: true });
    });
    return () => {
      appState.remove();
      tokenSub.remove();
    };
  }, [active, userId]);
}

/**
 * Salona katıldıktan sonra: izin yoksa ve hiç sorulmadıysa açıklama,
 * "İzin ver" denirse sistem penceresi; verilirse token hemen kaydedilir.
 * Bayrak / giriş zaten var (katılım ekranı).
 */
export async function askPushPermissionAfterJoin(userId: string): Promise<void> {
  try {
    const [granted, asked] = await Promise.all([api.isGranted(), wasRestPermissionAsked(Storage)]);
    if (granted) {
      void pushRegistrar.register(getSupabase(), userId);
      return;
    }
    if (!shouldExplainPushPermission(granted, asked)) return;
    Alert.alert(PUSH_PERMISSION_TEXT.title, PUSH_PERMISSION_TEXT.body, [
      { text: PUSH_PERMISSION_TEXT.later, style: 'cancel' },
      {
        text: PUSH_PERMISSION_TEXT.allow,
        onPress: () => {
          void ensureRestNotificationPermission(
            {
              isGranted: api.isGranted,
              request: async () => {
                await ensureChannels();
                return (await Notifications.requestPermissionsAsync()).granted;
              },
            },
            Storage
          )
            .then((ok) => {
              if (ok) void pushRegistrar.register(getSupabase(), userId, { force: true });
            })
            .catch((err) => console.warn('[PUSH] İzin:', err));
        },
      },
    ]);
  } catch (err) {
    console.warn('[PUSH] İzin:', err);
  }
}

/** Çıkıştan önce: sunucudaki token'ı sil, telefondaki kaydı unut */
export function unregisterPushBeforeSignOut(): Promise<void> {
  return pushRegistrar.unregister(getSupabase());
}

/** Hesap silindikten sonra (sunucuda cascade) */
export function forgetPushRegistration(): Promise<void> {
  return pushRegistrar.forget();
}

/**
 * Push bildirime dokununca ilgili ekran: duyurular ya da program
 * ekranında o ders. Uygulama kapalıyken dokunulduysa da (son yanıt) bir kez.
 */
export function usePushResponses(): void {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    const id = `${response.notification.request.identifier}:${response.notification.date}`;
    if (handled.current === id) return;
    const target = pushTarget(response.notification.request.content.data);
    if (!target) return;
    handled.current = id;
    // Gezinme ağacı hazır olsun
    const timer = setTimeout(() => {
      router.push(target);
    }, 0);
    return () => clearTimeout(timer);
  }, [response]);
}
