/**
 * Eşitleme arayüzünün saf mantığı (v3.1c, src/lib/sync/ui.ts): kart
 * durumları, 50+ silme sorusunun metinleri, hesap değiştirme akışı,
 * geri yükleme / sıfırlama uyarıları, hesap silme onayı.
 */

import { describe, expect, it } from 'vitest';

import { classifyAccountError, ACCOUNT_ERROR_MESSAGES } from '@/lib/auth';
import { deleteMyAccount } from '@/lib/account';
import {
  OWNER_MISMATCH_MESSAGE,
  confirmationMessage,
  describeRoots,
  waitingMessage,
  type SyncIssue,
  type SyncStatus,
} from '@/lib/sync/engine';
import {
  INITIAL_ACCOUNT_SWITCH,
  OFFLINE_TEXT,
  accountSwitchReducer,
  canConfirmAccountDeletion,
  confirmationCopy,
  formatAgo,
  restoreConfirmBody,
  syncCardView,
  wipeConfirmBody,
  type AccountSwitchAction,
  type AccountSwitchState,
} from '@/lib/sync/ui';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  tracking: true,
  ownerUserId: 'u1',
  initialUploadDone: true,
  lastSyncAt: '2026-10-12T11:58:00.000Z',
  pending: 0,
  held: 0,
  waiting: 0,
  dropped: 0,
  issue: null,
  ...over,
});

const confirmIssue = (direction: 'push' | 'pull', sessions: number, routines: number) =>
  ({
    kind: 'needs_confirmation',
    direction,
    deletes: sessions + routines,
    sessions,
    routines,
    message: confirmationMessage(direction, { sessions, routines }),
  }) as Extract<SyncIssue, { kind: 'needs_confirmation' }>;

describe('formatAgo', () => {
  it.each([
    [10_000, 'az önce'],
    [2 * 60_000, '2 dk önce'],
    [59 * 60_000, '59 dk önce'],
    [3 * 3600_000, '3 saat önce'],
    [5 * 86_400_000, '5 gün önce'],
    [-60_000, 'az önce'], // telefon saati geride
  ])('%i ms → %s', (diff, text) => {
    expect(formatAgo(new Date(NOW - diff).toISOString(), NOW)).toBe(text);
  });
});

describe('kart durumu', () => {
  const text = (s: SyncStatus | null, running = false) => {
    const v = syncCardView(s, running, NOW);
    if (v.kind !== 'status') throw new Error(v.kind);
    return v;
  };

  it('Eşitlendi · 2 dk önce', () => {
    expect(text(status())).toMatchObject({ text: 'Eşitlendi · 2 dk önce', tone: 'ok', retry: false });
  });

  it('Eşitleniyor… (öncelikli)', () => {
    expect(text(status({ pending: 3 }), true).text).toBe('Eşitleniyor…');
  });

  it('3 değişiklik bekliyor', () => {
    expect(text(status({ pending: 3 })).text).toBe('3 değişiklik bekliyor');
  });

  it('internet yok: tekrar dene yok, bağlanınca eşitlenecek', () => {
    const s = status({
      pending: 2,
      issue: { kind: 'error', errorKind: 'network', message: ACCOUNT_ERROR_MESSAGES.network },
    });
    expect(text(s)).toMatchObject({ text: OFFLINE_TEXT, retry: false, tone: 'muted' });
  });

  it('hata: kısa açıklama + tekrar dene', () => {
    const s = status({ issue: { kind: 'error', errorKind: 'server', message: ACCOUNT_ERROR_MESSAGES.server } });
    expect(text(s)).toMatchObject({ text: ACCOUNT_ERROR_MESSAGES.server, retry: true, tone: 'danger' });
  });

  it('henüz eşitlenmedi (durum yok ya da hiç eşitlenmemiş)', () => {
    expect(text(null).text).toBe('Henüz eşitlenmedi');
    expect(text(status({ lastSyncAt: null })).text).toBe('Henüz eşitlenmedi');
  });

  it('bekleyen satır uyarısı ayrı satırda, durum yine "Eşitlendi"', () => {
    const s = status({
      waiting: 2,
      issue: { kind: 'waiting_rows', waiting: 2, dropped: 0, message: waitingMessage(2, 0) },
    });
    expect(text(s)).toMatchObject({ text: 'Eşitlendi · 2 dk önce', notice: waitingMessage(2, 0) });
    expect(waitingMessage(2, 1)).toMatch(/2 kayıt.*1 kayıt/);
  });

  it('hesap uyuşmazlığı ve onay bekleyen silme kartın yerini alıyor', () => {
    expect(
      syncCardView(status({ issue: { kind: 'owner_mismatch', message: OWNER_MISMATCH_MESSAGE } }), false, NOW)
    ).toEqual({ kind: 'owner_mismatch' });
    const issue = confirmIssue('push', 52, 1);
    expect(syncCardView(status({ issue }), false, NOW)).toEqual({ kind: 'confirm', issue });
    // Cevap verilip eşitleme çalışırken soru kalkar
    expect(syncCardView(status({ issue }), true, NOW)).toMatchObject({ kind: 'status', text: 'Eşitleniyor…' });
  });
});

describe('50+ silme sorusu', () => {
  it('kaç antrenman ve rutin etkileneceği söyleniyor', () => {
    expect(describeRoots({ sessions: 52, routines: 1 })).toBe('52 antrenman ve 1 rutin');
    expect(describeRoots({ sessions: 0, routines: 51 })).toBe('51 rutin');
    expect(describeRoots({ sessions: 60, routines: 0 })).toBe('60 antrenman');
  });

  it('gönderme yönü: öne çıkan seçenek veriyi koruyor (buluttan geri getir)', () => {
    const c = confirmationCopy(confirmIssue('push', 52, 1));
    expect(c.body).toContain('52 antrenman ve 1 rutin');
    expect(c.keepLabel).toBe('Buluttan geri getir');
    expect(c.keepHint).toMatch(/geri iner.*Bulutta hiçbir şey silinmez/);
    expect(c.dropLabel).toBe('Buluttan da sil');
    expect(c.dropConfirmBody).toMatch(/^52 antrenman ve 1 rutin buluttan da kalıcı olarak silinir/);
  });

  it('çekme yönü: öne çıkan seçenek bu telefondakileri koruyor', () => {
    const c = confirmationCopy(confirmIssue('pull', 51, 0));
    expect(c.body).toContain('Bulutta 51 antrenman silinmiş');
    expect(c.keepLabel).toBe('Bu telefondakileri koru');
    expect(c.keepHint).toMatch(/buluta yeniden gönderilir/);
    expect(c.dropLabel).toBe('Bu telefondan da sil');
  });
});

describe('hesap değiştirme akışı (3.1)', () => {
  const run = (actions: AccountSwitchAction[]): AccountSwitchState =>
    actions.reduce(accountSwitchReducer, INITIAL_ACCOUNT_SWITCH);

  it('yedek → onay → temizlik → bitti', () => {
    expect(run([{ type: 'start' }]).step).toBe('backing_up');
    expect(run([{ type: 'start' }, { type: 'backup_done' }]).step).toBe('confirm');
    expect(
      run([{ type: 'start' }, { type: 'backup_done' }, { type: 'confirmed' }, { type: 'wiped' }]).step
    ).toBe('done');
  });

  it('yedek alınmadan temizliğe geçilemiyor', () => {
    expect(run([{ type: 'confirmed' }]).step).toBe('idle');
    expect(run([{ type: 'start' }, { type: 'confirmed' }]).step).toBe('backing_up');
    expect(run([{ type: 'start' }, { type: 'backup_failed', message: 'x' }, { type: 'confirmed' }])).toEqual({
      step: 'idle',
      error: 'x',
    });
  });

  it('ikinci onayda vazgeçilince başa dönülüyor; temizlik hatası gösteriliyor', () => {
    expect(run([{ type: 'start' }, { type: 'backup_done' }, { type: 'cancel' }])).toEqual(INITIAL_ACCOUNT_SWITCH);
    expect(
      run([{ type: 'start' }, { type: 'backup_done' }, { type: 'confirmed' }, { type: 'wipe_failed', message: 'e' }])
    ).toEqual({ step: 'idle', error: 'e' });
  });
});

describe('uyarılar (3.3)', () => {
  it('eşitleme kapalıyken metinler eskisiyle aynı', () => {
    expect(restoreConfirmBody(false)).toMatch(/^Geri yükleme birleştirme yapmaz/);
    expect(restoreConfirmBody(false)).not.toMatch(/Eşitleme/);
    expect(wipeConfirmBody(false)).toBe(
      'Rutinler, antrenman geçmişi ve vücut ölçümlerinin tamamı silinecek. Bu işlem geri alınamaz.'
    );
  });

  it('eşitleme açıkken', () => {
    expect(restoreConfirmBody(true)).toContain(
      'Eşitleme açık: yedek buluttaki verilerinle birleştirilir. Bulutta silinmiş antrenmanlar geri gelmez.'
    );
    const wipe = wipeConfirmBody(true);
    expect(wipe).toMatch(/^Bu telefondaki veriler silinir\. Buluttaki kopyan korunur/);
    expect(wipe).toMatch(/vücut ölçüleri .* geri gelmez/);
    expect(wipe).toMatch(/Hesabımı sil/);
  });
});

describe('hesabı silme (BÖLÜM 4)', () => {
  it('e-postanın aynısı yazılınca onaylanıyor', () => {
    expect(canConfirmAccountDeletion('ali@ornek.com', 'ali@ornek.com')).toBe(true);
    expect(canConfirmAccountDeletion('  ALI@ornek.com ', 'ali@ornek.com')).toBe(true);
    expect(canConfirmAccountDeletion('ali@ornek.co', 'ali@ornek.com')).toBe(false);
    expect(canConfirmAccountDeletion('', 'ali@ornek.com')).toBe(false);
    expect(canConfirmAccountDeletion('ali@ornek.com', null)).toBe(false);
  });

  it('tek yönetici hatası ayrı mesajla', () => {
    expect(classifyAccountError({ message: 'sole_admin', code: 'P0001' })).toBe('sole_admin');
    expect(ACCOUNT_ERROR_MESSAGES.sole_admin).toMatch(/tek yöneticisi/);
  });

  it('istemci yoksa ağa çıkmıyor', async () => {
    expect(await deleteMyAccount(null)).toMatchObject({ ok: false, error: { kind: 'not_configured' } });
  });

  it('başarılıysa yerel oturum kapanıyor; hata olursa oturum kalıyor', async () => {
    const calls: string[] = [];
    const client = (error: unknown) =>
      ({
        rpc: async (name: string) => {
          calls.push(name);
          return { data: null, error };
        },
        auth: {
          signOut: async ({ scope }: { scope: string }) => {
            calls.push(`signOut:${scope}`);
            return { error: null };
          },
        },
      }) as unknown as Parameters<typeof deleteMyAccount>[0];

    expect(await deleteMyAccount(client(null))).toEqual({ ok: true, value: null });
    expect(calls).toEqual(['delete_my_account', 'signOut:local']);

    calls.length = 0;
    expect(await deleteMyAccount(client({ message: 'sole_admin', code: 'P0001' }))).toMatchObject({
      ok: false,
      error: { kind: 'sole_admin' },
    });
    expect(calls).toEqual(['delete_my_account']);
  });
});
