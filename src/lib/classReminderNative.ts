/**
 * Ders hatırlatmasının Expo native katmanı (ince). Kararlar
 * `classReminders.ts`'te; burada yalnızca expo-notifications çağrıları.
 * `restNative.ts` gibi native modül içe aktaran istisnalardan; testlerde
 * içe aktarılmıyor.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import {
  CLASS_REMINDER_PREFIX,
  createClassReminderSync,
  reminderTarget,
  type ClassReminderApi,
} from '@/lib/classReminders';
import { ensureRestNotificationPermission, getRestNotificationEnabled } from '@/lib/restNotification';

/** Android bildirim kanalı. Kimliği değiştirme: kullanıcı ayarları kanala bağlı. */
const CLASS_CHANNEL_ID = 'classes';

let channelReady: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CLASS_CHANNEL_ID, {
    name: 'Ders hatırlatması',
    description: 'Katılacağın grup dersinden 1 saat önce haber verir',
    importance: Notifications.AndroidImportance.DEFAULT,
  })
    .then(() => undefined)
    .catch((err) => {
      channelReady = null;
      throw err;
    });
  return channelReady;
}

const api: ClassReminderApi = {
  async isGranted() {
    return (await Notifications.getPermissionsAsync()).granted;
  },
  isEnabled: () => getRestNotificationEnabled(Storage),
  async scheduledIds() {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.map((n) => n.identifier).filter((id) => id.startsWith(CLASS_REMINDER_PREFIX));
  },
  async schedule(r) {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { ...r.data }, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: r.fireAtMs,
        channelId: CLASS_CHANNEL_ID,
      },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
};

export const classReminderSync = createClassReminderSync(api, {
  onError: (err) => console.error('[CLASS-REMINDER] HATA:', err),
});

/**
 * İlk "Katılıyorum"da bir kez izin ister (dinlenme bildirimiyle aynı
 * "soruldu" bayrağı: daha önce sorulduysa / reddedildiyse sormaz).
 */
export async function ensureClassReminderPermission(): Promise<boolean> {
  try {
    return await ensureRestNotificationPermission(
      {
        isGranted: api.isGranted,
        request: async () => {
          await ensureChannel();
          return (await Notifications.requestPermissionsAsync()).granted;
        },
      },
      Storage
    );
  } catch (err) {
    console.error('[CLASS-REMINDER] İzin:', err);
    return false;
  }
}

/**
 * Hatırlatmaya dokununca program ekranında o günü ve dersi aç. Uygulama
 * kapalıyken dokunulduysa da (son yanıt) bir kez.
 */
export function useClassReminderResponses(): void {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    const id = `${response.notification.request.identifier}:${response.notification.date}`;
    if (handled.current === id) return;
    const target = reminderTarget(response.notification.request.content.data);
    if (!target) return;
    handled.current = id;
    // Gezinme ağacı hazır olsun
    const timer = setTimeout(() => {
      router.push({ pathname: '/classes', params: { date: target.date, focus: target.key, gymId: target.gymId } });
    }, 0);
    return () => clearTimeout(timer);
  }, [response]);
}
