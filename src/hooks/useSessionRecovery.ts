import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import type { Db } from '@/db/client';
import { useDb } from '@/hooks/useDb';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import {
  SAVED_REST_TIMER_KEY,
  canFinishOpenSession,
  decideSessionRecovery,
  deleteStaleEmptySessions,
  discardSession,
  findOpenSessions,
  parseSavedRestTimer,
  recoveryEndedAt,
  restorableRestTimer,
  type OpenSession,
} from '@/lib/sessionRecovery';
import { formatDateTime } from '@/lib/format';

type Router = ReturnType<typeof useRouter>;

/** Kurtarma uygulama açılışı başına bir kez; ana sayfa yeniden mount olunca tekrar bakılmaz */
let recoveryChecked = false;

/**
 * Açılışta yarım kalan antrenmanı geri getirir (bkz. `sessionRecovery.ts`).
 * Ana sayfada çağrılıyor: orası migration, seed ve karşılama kararından
 * sonra mount oluyor.
 *
 * `onDone`: kurtarma bitince (soru sorulduysa yanıtlanınca) bir kez;
 * hata olsa da çağrılır. Açılıştaki rıza sorusu bunun ardından geliyor.
 */
export function useSessionRecovery(onDone?: (result: RecoveryResult) => void): void {
  const db = useDb();
  const router = useRouter();

  useEffect(() => {
    if (recoveryChecked) return;
    recoveryChecked = true;
    recover(db, router)
      .catch((err) => {
        console.error('[SESSION-RECOVERY] HATA:', err);
        return { navigated: false };
      })
      .then((result) => onDone?.(result));
    // onDone ilk çalışmada yakalanıyor; kurtarma açılışta bir kez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, router]);
}

export interface RecoveryResult {
  /** Kullanıcı yarım antrenmanı açtı (Devam et / Bitir) */
  navigated: boolean;
}

async function recover(db: Db, router: Router): Promise<RecoveryResult> {
  // Önce kullanıcı verisi taşımayan boş yarım seanslar. Hata kurtarmayı
  // durdurmasın.
  try {
    const removed = await deleteStaleEmptySessions(
      db,
      Date.now(),
      useActiveWorkoutStore.getState().activeSessionId
    );
    if (__DEV__) console.log(`[SESSION-RECOVERY] ${removed} boş yarım seans silindi`);
  } catch (err) {
    console.warn('[SESSION-RECOVERY] Boş seanslar silinemedi:', err);
  }

  const openSessions = await findOpenSessions(db);
  const decision = decideSessionRecovery({
    activeSessionId: useActiveWorkoutStore.getState().activeSessionId,
    openSessions,
    nowMs: Date.now(),
  });
  if (__DEV__ && openSessions.length > 0) {
    console.log(
      `[SESSION-RECOVERY] ${openSessions.length} yarım seans, karar: ${decision.kind}`
    );
  }
  if (decision.kind === 'none') return { navigated: false };

  if (decision.kind === 'resume') {
    const saved = parseSavedRestTimer(await Storage.getItem(SAVED_REST_TIMER_KEY));
    // Sorgu sürerken kullanıcı yeni antrenman başlattıysa ona dokunma
    if (useActiveWorkoutStore.getState().activeSessionId != null) return { navigated: false };

    useActiveWorkoutStore.getState().startSession(decision.sessionId);
    const timer = restorableRestTimer(saved, decision.sessionId, Date.now());
    // Store'da sayacı verilen başlangıçla kuran action yok; startRestTimer
    // başlangıcı "şimdi" yapardı. Dinlenme bildirimi bu değişimi de duyup
    // kalan süreye göre yeniden planlıyor.
    if (timer) useActiveWorkoutStore.setState({ restTimer: timer });
    return { navigated: false };
  }

  return askAboutSession(db, router, decision.session);
}

/**
 * Yarım seansı aktif yapıp antrenman ekranını açar. `finish`: ekran
 * açılınca normal bitirme akışı (onay + onaylanmamış set sorusu) başlar;
 * seans son tamamlanan sette bitmiş sayılır.
 *
 * Başka bir antrenman sürüyorsa açmaz (onu ezmesin), false döner.
 */
export function openUnfinishedSession(
  router: Router,
  session: OpenSession,
  finish: boolean
): boolean {
  const active = useActiveWorkoutStore.getState().activeSessionId;
  if (active != null && active !== session.id) {
    Alert.alert(
      'Devam eden antrenman var',
      'Önce şu an devam eden antrenmanı bitir.'
    );
    return false;
  }
  if (active == null) useActiveWorkoutStore.getState().startSession(session.id);
  router.push(
    finish
      ? {
          pathname: '/session/active',
          params: { finish: '1', finishAt: recoveryEndedAt(session) },
        }
      : '/session/active'
  );
  return true;
}

/** "Sil" onayı; silindikten sonra `onDeleted`, her durumda en son `onClosed` */
export function confirmDiscardSession(
  db: Db,
  session: OpenSession,
  onDeleted?: () => void,
  onClosed?: () => void
): void {
  Alert.alert(
    'Antrenmanı sil',
    `"${session.name}" ve içindeki bütün setler silinecek. Bu işlem geri alınamaz.`,
    [
      { text: 'Vazgeç', style: 'cancel', onPress: () => onClosed?.() },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          discardSession(db, session.id)
            .then(() => onDeleted?.())
            .catch((err) => {
              console.error('[SESSION-RECOVERY] Silinemedi:', err);
              Alert.alert('Hata', 'Antrenman silinemedi: ' + String(err));
            })
            .finally(() => onClosed?.());
        },
      },
    ]
  );
}

/**
 * 12 saat – 3 gün arası yarım seans: Devam et / Bitir / Sil. Hiç set
 * tamamlanmadıysa Bitir yok, silme öneriliyor.
 *
 * Kullanıcı yanıt verince çözülür; `navigated`: antrenman ekranı açıldı.
 */
function askAboutSession(
  db: Db,
  router: Router,
  session: OpenSession
): Promise<RecoveryResult> {
  return new Promise((resolve) => {
    const started = `"${session.name}" ${formatDateTime(session.startedAt)} tarihinde başladı ve bitirilmedi.`;
    const open = (finish: boolean) =>
      resolve({ navigated: openUnfinishedSession(router, session, finish) });
    const discard = () =>
      confirmDiscardSession(db, session, undefined, () => resolve({ navigated: false }));

    if (!canFinishOpenSession(session)) {
      Alert.alert(
        'Yarım kalan antrenman',
        `${started}\n\nHiç set tamamlanmamış; silmeni öneririz.`,
        [
          { text: 'Devam et', onPress: () => open(false) },
          { text: 'Sil', style: 'destructive', onPress: discard },
        ]
      );
      return;
    }

    Alert.alert('Yarım kalan antrenman', started, [
      { text: 'Devam et', onPress: () => open(false) },
      { text: 'Bitir', onPress: () => open(true) },
      { text: 'Sil', style: 'destructive', onPress: discard },
    ]);
  });
}
