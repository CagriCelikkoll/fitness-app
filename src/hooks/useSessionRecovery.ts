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
 */
export function useSessionRecovery(): void {
  const db = useDb();
  const router = useRouter();

  useEffect(() => {
    if (recoveryChecked) return;
    recoveryChecked = true;
    recover(db, router).catch((err) =>
      console.error('[SESSION-RECOVERY] HATA:', err)
    );
  }, [db, router]);
}

async function recover(db: Db, router: Router): Promise<void> {
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
  if (decision.kind === 'none') return;

  if (decision.kind === 'resume') {
    const saved = parseSavedRestTimer(await Storage.getItem(SAVED_REST_TIMER_KEY));
    // Sorgu sürerken kullanıcı yeni antrenman başlattıysa ona dokunma
    if (useActiveWorkoutStore.getState().activeSessionId != null) return;

    useActiveWorkoutStore.getState().startSession(decision.sessionId);
    const timer = restorableRestTimer(saved, decision.sessionId, Date.now());
    // Store'da sayacı verilen başlangıçla kuran action yok; startRestTimer
    // başlangıcı "şimdi" yapardı. Dinlenme bildirimi bu değişimi de duyup
    // kalan süreye göre yeniden planlıyor.
    if (timer) useActiveWorkoutStore.setState({ restTimer: timer });
    return;
  }

  askAboutSession(db, router, decision.session);
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

/** "Sil" onayı; silindikten sonra `onDeleted` */
export function confirmDiscardSession(
  db: Db,
  session: OpenSession,
  onDeleted?: () => void
): void {
  Alert.alert(
    'Antrenmanı sil',
    `"${session.name}" ve içindeki bütün setler silinecek. Bu işlem geri alınamaz.`,
    [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          discardSession(db, session.id)
            .then(() => onDeleted?.())
            .catch((err) => {
              console.error('[SESSION-RECOVERY] Silinemedi:', err);
              Alert.alert('Hata', 'Antrenman silinemedi: ' + String(err));
            });
        },
      },
    ]
  );
}

/**
 * 12 saat – 3 gün arası yarım seans: Devam et / Bitir / Sil. Hiç set
 * tamamlanmadıysa Bitir yok, silme öneriliyor.
 */
function askAboutSession(db: Db, router: Router, session: OpenSession): void {
  const started = `"${session.name}" ${formatDateTime(session.startedAt)} tarihinde başladı ve bitirilmedi.`;
  const resume = () => void openUnfinishedSession(router, session, false);
  const discard = () => confirmDiscardSession(db, session);

  if (!canFinishOpenSession(session)) {
    Alert.alert(
      'Yarım kalan antrenman',
      `${started}\n\nHiç set tamamlanmamış; silmeni öneririz.`,
      [
        { text: 'Devam et', onPress: resume },
        { text: 'Sil', style: 'destructive', onPress: discard },
      ]
    );
    return;
  }

  Alert.alert('Yarım kalan antrenman', started, [
    { text: 'Devam et', onPress: resume },
    { text: 'Bitir', onPress: () => void openUnfinishedSession(router, session, true) },
    { text: 'Sil', style: 'destructive', onPress: discard },
  ]);
}
