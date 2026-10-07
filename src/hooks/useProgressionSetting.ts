import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import {
  DEFAULT_PROGRESSION_ENABLED,
  getProgressionEnabled,
  setProgressionEnabled,
} from '@/lib/progression';

/**
 * "İlerleme önerileri" ayarı (kv-store, varsayılan açık). Ekran odağa
 * gelince yeniden okunuyor: Ayarlar'da değişip geri dönünce güncel olsun.
 *
 * `loaded` false iken öneri gösterilmiyor; kapalı ayar bir an için açık
 * görünmesin.
 */
export function useProgressionSetting(): {
  enabled: boolean;
  loaded: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
} {
  const [enabled, setEnabledState] = useState(DEFAULT_PROGRESSION_ENABLED);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getProgressionEnabled(Storage)
        .then((v) => {
          if (active) setEnabledState(v);
        })
        .catch((err) => console.error('[PROGRESSION] Ayar okunamadı:', err))
        .finally(() => {
          if (active) setLoaded(true);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  const setEnabled = useCallback(async (value: boolean) => {
    setEnabledState(value);
    try {
      await setProgressionEnabled(Storage, value);
    } catch (err) {
      console.error('[PROGRESSION] Kaydedilemedi:', err);
      Alert.alert('Kaydetme hatası', String(err));
    }
  }, []);

  return { enabled, loaded, setEnabled };
}
