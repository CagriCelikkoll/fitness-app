import { useCallback, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import {
  DEFAULT_REST_NOTIFICATION_ENABLED,
  getRestNotificationEnabled,
  setRestNotificationEnabled,
  type RestNotificationPermissionState,
} from '@/lib/restNotification';
import {
  getRestNotificationPermissionState,
  restNotificationScheduler,
} from '@/lib/restNative';

/**
 * "Dinlenme bildirimi" ayarı (kv-store) ve bildirim izninin durumu.
 *
 * İzin durumu ekran odağa geldiğinde ve uygulama ön plana dönünce
 * yeniden okunuyor: kullanıcı "Ayarları aç" ile telefon ayarlarından
 * izni açıp geri gelince satır güncellensin.
 */
export function useRestNotificationSetting(): {
  enabled: boolean;
  permission: RestNotificationPermissionState | null;
  loaded: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
} {
  const [enabled, setEnabledState] = useState(DEFAULT_REST_NOTIFICATION_ENABLED);
  const [permission, setPermission] = useState<RestNotificationPermissionState | null>(
    null
  );
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const refreshPermission = () => {
        getRestNotificationPermissionState()
          .then((p) => {
            if (active) setPermission(p);
          })
          .catch((err) => console.error('[REST-NOTIFICATION] İzin okunamadı:', err));
      };

      getRestNotificationEnabled(Storage)
        .then((v) => {
          if (active) setEnabledState(v);
        })
        .catch((err) => console.error('[REST-NOTIFICATION] Ayar okunamadı:', err))
        .finally(() => {
          if (active) setLoaded(true);
        });
      refreshPermission();

      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refreshPermission();
      });
      return () => {
        active = false;
        sub.remove();
      };
    }, [])
  );

  const setEnabled = useCallback(async (value: boolean) => {
    setEnabledState(value);
    try {
      await setRestNotificationEnabled(Storage, value);
      // Kapatınca çalışan dinlenmenin bildirimi de kalksın
      if (!value) await restNotificationScheduler.cancel();
    } catch (err) {
      console.error('[REST-NOTIFICATION] Kaydedilemedi:', err);
      Alert.alert('Kaydetme hatası', String(err));
    }
  }, []);

  return { enabled, permission, loaded, setEnabled };
}
