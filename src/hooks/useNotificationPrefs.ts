import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { useGymMembership } from '@/hooks/useGymMembership';
import {
  DEFAULT_NOTIFICATION_PREFS,
  fetchNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from '@/lib/push';
import { getSupabase } from '@/lib/supabase';

/**
 * Salon bildirim tercihleri (v3.3, sunucuda): "Salon duyuruları" ve "Ders
 * iptalleri ve değişiklikleri". Yalnızca salon üyesiyken görünür
 * (`visible`); ekran odağa gelince sunucudan okunur. Değişiklik hemen
 * görünür, kaydedilemezse geri alınır.
 */
export function useNotificationPrefs(): {
  visible: boolean;
  loaded: boolean;
  prefs: NotificationPrefs;
  setPref: (key: keyof NotificationPrefs, value: boolean) => void;
} {
  const { available, userId, memberships } = useGymMembership();
  const visible = available && userId != null && memberships.length > 0;
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loaded, setLoaded] = useState(false);
  const current = useRef(prefs);
  current.current = prefs;

  useFocusEffect(
    useCallback(() => {
      if (!visible || !userId) return;
      let active = true;
      void fetchNotificationPrefs(getSupabase(), userId).then((r) => {
        if (!active) return;
        if (r.ok) setPrefs(r.value);
        else console.warn('[PUSH] Tercihler okunamadı:', r.error.kind);
        setLoaded(true);
      });
      return () => {
        active = false;
      };
    }, [visible, userId])
  );

  const setPref = useCallback(
    (key: keyof NotificationPrefs, value: boolean) => {
      if (!userId) return;
      const before = current.current;
      const next = { ...before, [key]: value };
      setPrefs(next);
      void saveNotificationPrefs(getSupabase(), userId, next).then((r) => {
        if (r.ok) return;
        setPrefs(before);
        Alert.alert('Kaydedilemedi', r.error.message);
      });
    },
    [userId]
  );

  return { visible, loaded, prefs, setPref };
}
