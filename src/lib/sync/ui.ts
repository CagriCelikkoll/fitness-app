/**
 * Eşitleme arayüzünün saf mantığı (v3.1c): kartın durumu, onay
 * sorularının metinleri, hesap değiştirme akışı, uyarı metinleri,
 * hesap silme onayı. React yok, testli (test/syncUi.test.ts).
 */

import { normalizeEmail } from '@/lib/auth';

import { describeRoots, type SyncIssue, type SyncStatus } from './engine';

// ============================================================================
// Kart durumu
// ============================================================================

/** "az önce", "2 dk önce", "3 saat önce", "5 gün önce" */
export function formatAgo(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

export type SyncTone = 'ok' | 'muted' | 'danger';

export type SyncCardView =
  | { kind: 'owner_mismatch' }
  | { kind: 'confirm'; issue: Extract<SyncIssue, { kind: 'needs_confirmation' }> }
  | {
      kind: 'status';
      text: string;
      tone: SyncTone;
      /** Hata: "Tekrar dene" göster */
      retry: boolean;
      /** Atlanan / bekleyen satır uyarısı */
      notice: string | null;
      /** Tanınmayan hatanın ham metni, küçük yazıyla (teşhis için) */
      detail: string | null;
    };

export const SYNC_INFO_TEXT =
  'Antrenmanların ve rutinlerin hesabına yedeklenir. Vücut ölçülerin yalnızca bu telefonda kalır.';

export const OFFLINE_TEXT = 'İnternet yok — bağlanınca eşitlenecek';

/**
 * Durum satırı, tek cümle. Öncelik: hesap uyuşmazlığı / onay (kartın
 * yerine soru) → eşitleniyor → hata → bekleyen değişiklik → son eşitleme.
 */
export function syncCardView(status: SyncStatus | null, running: boolean, nowMs: number): SyncCardView {
  const issue = status?.issue ?? null;
  if (issue?.kind === 'owner_mismatch') return { kind: 'owner_mismatch' };
  if (issue?.kind === 'needs_confirmation' && !running) return { kind: 'confirm', issue };

  const notice = issue?.kind === 'waiting_rows' ? issue.message : null;
  const detail = issue?.kind === 'error' ? (issue.detail ?? null) : null;
  const view = (text: string, tone: SyncTone, retry = false): SyncCardView => ({
    kind: 'status',
    text,
    tone,
    retry,
    notice,
    detail,
  });

  if (running) return view('Eşitleniyor…', 'muted');
  if (issue?.kind === 'error') {
    if (issue.errorKind === 'network') return view(OFFLINE_TEXT, 'muted');
    return view(issue.message, 'danger', true);
  }
  if (status && status.pending > 0) {
    return view(`${status.pending} değişiklik bekliyor`, 'muted');
  }
  if (status?.lastSyncAt) return view(`Eşitlendi · ${formatAgo(status.lastSyncAt, nowMs)}`, 'ok');
  return view('Henüz eşitlenmedi', 'muted');
}

// ============================================================================
// 50+ silme onayı
// ============================================================================

export interface ConfirmationCopy {
  title: string;
  body: string;
  /** Veriyi koruyan, öne çıkan seçenek */
  keepLabel: string;
  keepHint: string;
  /** Silmeyi uygulayan seçenek (ikinci onayla) */
  dropLabel: string;
  dropConfirmTitle: string;
  dropConfirmBody: string;
}

export function confirmationCopy(issue: Extract<SyncIssue, { kind: 'needs_confirmation' }>): ConfirmationCopy {
  const what = describeRoots(issue);
  if (issue.direction === 'push') {
    return {
      title: 'Silme onayı bekliyor',
      body: `Bu telefonda ${what} silinmiş. Eşitleme durdu; buluttaki kopyalar hâlâ duruyor.`,
      keepLabel: 'Buluttan geri getir',
      keepHint: `Silinen ${what} bu telefona geri iner. Bulutta hiçbir şey silinmez.`,
      dropLabel: 'Buluttan da sil',
      dropConfirmTitle: 'Buluttan da silinsin mi?',
      dropConfirmBody: `${capitalize(what)} buluttan da kalıcı olarak silinir. Bu işlem geri alınamaz.`,
    };
  }
  return {
    title: 'Silme onayı bekliyor',
    body: `Bulutta ${what} silinmiş; başka bir telefonda silinmiş olabilir. Eşitleme durdu; bu telefondakiler hâlâ duruyor.`,
    keepLabel: 'Bu telefondakileri koru',
    keepHint: `${capitalize(what)} bu telefonda kalır ve buluta yeniden gönderilir.`,
    dropLabel: 'Bu telefondan da sil',
    dropConfirmTitle: 'Bu telefondan da silinsin mi?',
    dropConfirmBody: `${capitalize(what)} bu telefondan da silinir. Yedeğin yoksa geri getirilemez.`,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1);
}

// ============================================================================
// Hesap uyuşmazlığı (3.1)
// ============================================================================

export const OWNER_MISMATCH_COPY = {
  title: 'Bu telefondaki antrenmanlar başka bir hesaba ait',
  body: 'Eşitleme durduruldu; hiçbir şey gönderilmedi ya da silinmedi. Önceki hesabına dönebilir ya da bu telefonu yeni hesapla kullanabilirsin.',
  backLabel: 'Önceki hesaba dön',
  backHint: 'Çıkış yapılır; önceki hesabınla yeniden giriş yapabilirsin.',
  switchLabel: 'Bu telefonu yeni hesapla kullan',
  switchHint: 'Önce yedek alınır, sonra bu telefondaki veriler silinip yeni hesabın verisi indirilir.',
  confirmTitle: 'Telefondaki veriler silinecek',
  confirmBody:
    'Bu telefondaki antrenmanlar, rutinler ve vücut ölçüleri silinecek. Aldığın yedek ve önceki hesabın bulutundaki kopyası durur. Ardından yeni hesabının verisi indirilir.',
  confirmLabel: 'Sil ve yeni hesapla devam et',
} as const;

/**
 * "Bu telefonu yeni hesapla kullan": yedek ZORUNLU → ikinci onay →
 * temizlik → çekme. Yedek alınmadan temizliğe geçilemez.
 */
export type AccountSwitchStep = 'idle' | 'backing_up' | 'confirm' | 'wiping' | 'done';

export interface AccountSwitchState {
  step: AccountSwitchStep;
  error: string | null;
}

export type AccountSwitchAction =
  | { type: 'start' }
  | { type: 'backup_done' }
  | { type: 'backup_failed'; message: string }
  | { type: 'cancel' }
  | { type: 'confirmed' }
  | { type: 'wiped' }
  | { type: 'wipe_failed'; message: string };

export const INITIAL_ACCOUNT_SWITCH: AccountSwitchState = { step: 'idle', error: null };

export function accountSwitchReducer(
  state: AccountSwitchState,
  action: AccountSwitchAction
): AccountSwitchState {
  switch (action.type) {
    case 'start':
      return state.step === 'idle' || state.step === 'done' ? { step: 'backing_up', error: null } : state;
    case 'backup_done':
      return state.step === 'backing_up' ? { step: 'confirm', error: null } : state;
    case 'backup_failed':
      return state.step === 'backing_up' ? { step: 'idle', error: action.message } : state;
    case 'cancel':
      return state.step === 'confirm' ? INITIAL_ACCOUNT_SWITCH : state;
    case 'confirmed':
      return state.step === 'confirm' ? { step: 'wiping', error: null } : state;
    case 'wiped':
      return state.step === 'wiping' ? { step: 'done', error: null } : state;
    case 'wipe_failed':
      return state.step === 'wiping' ? { step: 'idle', error: action.message } : state;
  }
}

// ============================================================================
// Geri yükleme ve sıfırlama uyarıları (3.3)
// ============================================================================

const RESTORE_BODY =
  'Geri yükleme birleştirme yapmaz. Cihazdaki rutinler, antrenmanlar, ölçümler ve egzersiz kütüphanesi silinip yedektekiyle değiştirilecek. Bu işlem geri alınamaz.';

export function restoreConfirmBody(syncActive: boolean): string {
  if (!syncActive) return RESTORE_BODY;
  return `${RESTORE_BODY}\n\nEşitleme açık: yedek buluttaki verilerinle birleştirilir. Bulutta silinmiş antrenmanlar geri gelmez.`;
}

const WIPE_BODY =
  'Rutinler, antrenman geçmişi ve vücut ölçümlerinin tamamı silinecek. Bu işlem geri alınamaz.';

export function wipeConfirmBody(syncActive: boolean): string {
  if (!syncActive) return WIPE_BODY;
  return 'Bu telefondaki veriler silinir. Buluttaki kopyan korunur ve bir sonraki eşitlemede geri gelir; vücut ölçüleri yalnızca bu telefonda olduğu için geri gelmez. Buluttaki verini de silmek istiyorsan Hesabımı sil\'i kullan.';
}

// ============================================================================
// Hesabı silme (BÖLÜM 4)
// ============================================================================

export const DELETE_ACCOUNT_TEXT =
  'Hesabın, salon üyeliğin ve buluttaki tüm antrenmanların kalıcı olarak silinir. Bu telefondaki veriler kalır.';

/** Onay: e-postanın aynısı yazılmalı (büyük/küçük harf ve boşluk önemsiz) */
export function canConfirmAccountDeletion(typed: string, email: string | null): boolean {
  if (!email) return false;
  const a = normalizeEmail(typed);
  return a.length > 0 && a === normalizeEmail(email);
}
