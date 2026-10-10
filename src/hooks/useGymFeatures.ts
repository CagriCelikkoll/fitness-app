import { useEffect } from 'react';
import { Alert } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import {
  getGymFeaturesEnabled,
  setGymFeaturesEnabled as saveGymFeaturesEnabled,
} from '@/lib/supabaseConfig';
import { activateSupabase, deactivateSupabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * "Salon özellikleri (deneysel)" bayrağı (v3.0, kv-store, varsayılan
 * kapalı). Ayarlar → Hakkında → sürüm satırına 7 dokunuşla görünür.
 *
 * Kapalıyken hesap / salon arayüzü hiç görünmez ve Supabase istemcisi
 * kurulmaz. Ortak durum: Ayarlar'da açılınca ana sayfa da güncellensin.
 *
 * `available`: bayrak açık VE env tanımlı. Env yoksa bayrak açık olsa da
 * hesap bölümü gizli kalıyor (bayrak satırı açıklama gösteriyor).
 */
const useFlagStore = create<{ enabled: boolean | null }>(() => ({ enabled: null }));

let loading = false;

function ensureLoaded(): void {
  if (useFlagStore.getState().enabled != null || loading) return;
  loading = true;
  getGymFeaturesEnabled(Storage)
    .then((enabled) => {
      if (enabled) activateSupabase();
      useFlagStore.setState({ enabled });
    })
    .catch((err) => {
      console.error('[ACCOUNT] Bayrak okunamadı:', err);
      useFlagStore.setState({ enabled: false });
    })
    .finally(() => {
      loading = false;
    });
}

export function useGymFeatures(): {
  /** null: yükleniyor */
  enabled: boolean | null;
  available: boolean;
  configured: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
} {
  const enabled = useFlagStore((s) => s.enabled);

  useEffect(() => {
    ensureLoaded();
  }, []);

  const setEnabled = async (value: boolean) => {
    try {
      await saveGymFeaturesEnabled(Storage, value);
    } catch (err) {
      console.error('[ACCOUNT] Bayrak kaydedilemedi:', err);
      Alert.alert('Kaydetme hatası', String(err));
      return;
    }
    if (value) activateSupabase();
    else deactivateSupabase();
    useFlagStore.setState({ enabled: value });
  };

  const configured = isSupabaseConfigured();
  return { enabled, available: enabled === true && configured, configured, setEnabled };
}
