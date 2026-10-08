import { useEffect } from 'react';
import { Alert } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';

import type { Db } from '@/db/client';
import { CONSENT_WITHDRAW_PROMPT } from '@/content/legal';
import {
  canUseBodyMetrics,
  countBodyMetrics,
  deleteAllBodyMetrics,
  getConsentState,
  saveConsent,
  shouldAskExistingUser,
  type ConsentState,
  type ConsentStatus,
} from '@/lib/consent';

/**
 * Rıza durumu bütün ekranlarda ortak: bir yerde onaylanınca ana sayfa,
 * İlerleme ve ölçüm ekranı aynı anda güncellensin. kv-store'dan bir kez
 * okunuyor; yazmalar buradan geçiyor.
 */
const useConsentStore = create<{
  state: ConsentState | null;
  setState: (state: ConsentState) => void;
}>((set) => ({
  state: null,
  setState: (state) => set({ state }),
}));

let loading: Promise<void> | null = null;

function ensureLoaded(): void {
  if (useConsentStore.getState().state != null || loading) return;
  loading = getConsentState(Storage)
    .then((state) => useConsentStore.getState().setState(state))
    .catch((err) => {
      // Okunamazsa giriş kapalı kalsın (rıza varsayılmaz)
      console.error('[CONSENT] Okunamadı:', err);
      useConsentStore.getState().setState('unknown');
    })
    .finally(() => {
      loading = null;
    });
}

/** Rızayı yazar; ortak durumu yalnızca yazma başarılıysa günceller */
export async function setHealthConsent(status: ConsentStatus): Promise<void> {
  await saveConsent(Storage, status);
  useConsentStore.getState().setState(status);
}

/** Açılış kontrolü gibi hook dışı yerler için */
export async function readHealthConsent(): Promise<ConsentState> {
  const current = useConsentStore.getState().state;
  if (current != null) return current;
  const state = await getConsentState(Storage);
  useConsentStore.getState().setState(state);
  return state;
}

/**
 * Vücut ölçüleri rızası.
 * - `state`: null iken yükleniyor (kapı gösterilmez, içerik de)
 * - `granted`: ölçü girişi, grafiği ve geçmişi açık
 */
export function useHealthConsent(): {
  state: ConsentState | null;
  granted: boolean;
  grant: () => Promise<boolean>;
} {
  const state = useConsentStore((s) => s.state);

  useEffect(() => {
    ensureLoaded();
  }, []);

  const grant = async (): Promise<boolean> => {
    try {
      await setHealthConsent('granted');
      return true;
    } catch (err) {
      console.error('[CONSENT] Kaydedilemedi:', err);
      Alert.alert('Kaydetme hatası', String(err));
      return false;
    }
  };

  return { state, granted: state != null && canUseBodyMetrics(state), grant };
}

/**
 * Açılışta, güncellemeyle gelen kullanıcıya bir kez: rıza hiç sorulmamış
 * ve ölçü kaydı varsa tam ekran rıza sorusu (`app/consent.tsx`).
 * Yarım antrenman kurtarmasından sonra çağrılıyor.
 */
export async function runConsentLaunchCheck(
  db: Db,
  openConsentScreen: () => void
): Promise<void> {
  try {
    const state = await readHealthConsent();
    if (state !== 'unknown') return;
    const bodyMetricCount = await countBodyMetrics(db);
    if (shouldAskExistingUser({ state, bodyMetricCount })) openConsentScreen();
  } catch (err) {
    // Sorulamazsa giriş yine kapalı; ilk ölçü girişinde kapı soruyor
    console.error('[CONSENT] Açılış kontrolü yapılamadı:', err);
  }
}

/**
 * "Vücut ölçüsü kayıtların ne olsun?" — rıza geri alınırken ya da açılış
 * sorusunda "Onaylamıyorum" denince.
 * - Hepsini sil → ikinci onay → ölçüler silinir, durum `withdrawn`
 * - Sakla, yeni girişi kapat → kayıtlar kalır, durum `withdrawn`
 * - Vazgeç → hiçbir şey değişmez
 *
 * `onDone`: durum `withdrawn` yazıldıktan sonra.
 */
export function promptConsentWithdraw(db: Db, onDone?: () => void): void {
  const withdraw = async (deleteRecords: boolean) => {
    try {
      // Önce silme: başarısızsa durum değişmesin
      if (deleteRecords) await deleteAllBodyMetrics(db);
      await setHealthConsent('withdrawn');
      onDone?.();
    } catch (err) {
      console.error('[CONSENT] Geri alınamadı:', err);
      Alert.alert('Hata', String(err));
    }
  };

  Alert.alert(CONSENT_WITHDRAW_PROMPT.title, undefined, [
    {
      text: CONSENT_WITHDRAW_PROMPT.deleteAll,
      style: 'destructive',
      onPress: () =>
        Alert.alert('Vücut ölçüleri silinecek', 'Bu işlem geri alınamaz.', [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Sil',
            style: 'destructive',
            onPress: () => void withdraw(true),
          },
        ]),
    },
    { text: CONSENT_WITHDRAW_PROMPT.keep, onPress: () => void withdraw(false) },
    { text: CONSENT_WITHDRAW_PROMPT.cancel, style: 'cancel' },
  ]);
}
