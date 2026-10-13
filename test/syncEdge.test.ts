/**
 * Eşitleme kenar durumları (v3.1c):
 * - BÖLÜM 1: ebeveyni henüz gelmemiş satır kaybolmuyor (bekletiliyor,
 *   imleç önüne geçmiyor); gönderim ebeveynleri önce gönderiyor; küçük
 *   sayfalarla çekme; silinmiş ebeveyn; 7 günlük sınır.
 * - 3.2: onay bekleyen silmede veriyi koruyan iki seçenek.
 * - 3.1: hesap değiştirme (temizlik + yeni hesabın verisi).
 * - BÖLÜM 4: hesap silindikten sonra eşitleme durumu.
 */

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  routines,
  sessionExercises,
  sets,
  syncOutbox,
  workoutSessions,
} from '@/db/schema';
import { wipeUserData } from '@/lib/backup';
import { newId } from '@/lib/id';
import {
  DELETE_CONFIRM_LIMIT,
  ORPHAN_WAIT_MS,
  getSyncStatus,
  keepLocalCopies,
  readSendableOutbox,
  restoreDeletedFromCloud,
} from '@/lib/sync/engine';
import { SYNC_TABLE_NAMES } from '@/lib/sync/tables';
import type { SyncChange } from '@/lib/sync/types';
import { readSyncState, resetSyncAfterAccountDeleted } from '@/lib/syncState';

import { FakeSyncServer } from './helpers/fakeSyncServer';
import {
  A,
  B,
  closePhones,
  expectOk,
  newRoutine,
  outboxCount,
  phone,
  sync,
  synced,
  workout,
} from './helpers/syncPhones';

afterEach(closePhones);

const iso = () => new Date().toISOString();

/** A'nın gönderiminin yarıda kalması: yalnızca çocuk satırlar buluta gitmiş */
function childrenOnly(sessionId: string): SyncChange[] {
  const at = iso();
  return [
    {
      t: 'session_exercises',
      id: 'se-yetim',
      at,
      row: { id: 'se-yetim', session_id: sessionId, exercise_id: 'Barbell_Squat', order_index: 0, superset_group: null, notes: null },
    },
    {
      t: 'sets',
      id: 'set-yetim',
      at,
      row: {
        id: 'set-yetim',
        session_exercise_id: 'se-yetim',
        set_number: 1,
        set_type: 'normal',
        reps: 5,
        weight_kg: 100,
        rir: null,
        rpe: null,
        is_completed: true,
        rest_taken_seconds: null,
        notes: null,
        completed_at: at,
      },
    },
  ];
}

function sessionRow(id: string): SyncChange {
  const at = iso();
  return {
    t: 'workout_sessions',
    id,
    at,
    row: {
      id,
      routine_id: null,
      name: 'Geç gelen',
      started_at: at,
      ended_at: at,
      duration_seconds: 3600,
      notes: null,
      bodyweight_kg: null,
      perceived_difficulty: null,
      created_at: '2026-10-12 10:00:00',
    },
  };
}

describe('BÖLÜM 1: ebeveyni gelmemiş satır', () => {
  it('çocuk ebeveyninden önceki eşitlemede gelirse kaybolmuyor: bekletiliyor, sonra ekleniyor', async () => {
    const server = new FakeSyncServer();
    const b = await phone();
    await expectOk(sync(b, server));

    // A'nın gönderimi yarıda kaldı: hareket ve set bulutta, antrenman yok
    await server.transport(A).push(childrenOnly('s-gec'));
    server.advance(60_000);
    const first = await expectOk(sync(b, server));
    expect(first).toMatchObject({ waiting: 2, dropped: 0 });
    expect(await b.db.select().from(sets)).toEqual([]);
    const status = await getSyncStatus(b.db);
    expect(status).toMatchObject({ waiting: 2, dropped: 0, issue: { kind: 'waiting_rows' } });

    // Saatler sonra A'nın gönderimi tamamlanıyor (örtüşme penceresinin çok dışında)
    server.advance(6 * 3600_000);
    await server.transport(A).push([sessionRow('s-gec')]);
    server.advance(60_000);
    const second = await expectOk(sync(b, server));
    expect(second).toMatchObject({ waiting: 0, dropped: 0 });
    expect((await b.db.select().from(sets)).map((s) => s.id)).toEqual(['set-yetim']);
    expect(await b.db.select().from(sessionExercises).where(eq(sessionExercises.sessionId, 's-gec'))).toHaveLength(1);
    expect((await getSyncStatus(b.db)).issue).toBeNull();
  });

  it('aynı çekmede çocuk ebeveyninden önceki sayfada: sayfa büyüklüğü 2 ile her şey iniyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const b = await phone();
    const r = await newRoutine(a.db, 'R', 2);
    for (let i = 0; i < 4; i++) await workout(a.db, r);
    await expectOk(sync(a, server));
    const res = await expectOk(sync(b, server, A, false, 2));
    expect(res).toMatchObject({ waiting: 0, dropped: 0 });
    expect(await synced(b.db)).toEqual(await synced(a.db));
  });

  it('ebeveyni bulutta silinmiş satır sessizce atılıyor (beklemiyor)', async () => {
    const server = new FakeSyncServer();
    const b = await phone();
    await expectOk(sync(b, server));
    await server.transport(A).push([sessionRow('s-silinen')]);
    server.advance(1);
    await server.transport(A).push([{ t: 'workout_sessions', id: 's-silinen', at: iso(), row: null }]);
    server.advance(1);
    await server.transport(A).push(childrenOnly('s-silinen'));
    server.advance(60_000);
    const res = await expectOk(sync(b, server));
    expect(res).toMatchObject({ waiting: 0, dropped: 0 });
    expect(await b.db.select().from(sets)).toEqual([]);
  });

  it('7 günden uzun bekleyen satır atılıp sayılıyor; imleç ilerliyor', async () => {
    const server = new FakeSyncServer();
    const b = await phone();
    await expectOk(sync(b, server));
    await server.transport(A).push(childrenOnly('hic-gelmeyecek'));
    server.advance(ORPHAN_WAIT_MS + 60_000);
    const res = await expectOk(sync(b, server));
    expect(res).toMatchObject({ waiting: 0, dropped: 2 });
    expect(await getSyncStatus(b.db)).toMatchObject({ waiting: 0, dropped: 2 });
    const cursor = (await readSyncState(b.db))!.pullCursor!;
    expect(Date.parse(cursor)).toBeGreaterThan(server.nowMs - 60_000);
  });

  it('gönderim ebeveyn tabloları önce gönderiyor (zaman sırasından bağımsız)', async () => {
    const a = await phone();
    const server = new FakeSyncServer();
    await expectOk(sync(a, server));
    const r = await newRoutine(a.db);
    await workout(a.db, r);
    // Setler en sona düzenlensin: zaman sırasıyla gönderilseydi en son giderlerdi
    await a.db.update(routines).set({ name: 'son düzenleme' }).where(eq(routines.id, r));
    const entries = await readSendableOutbox(a.db, 1000);
    const ranks = entries.map((e) => SYNC_TABLE_NAMES.indexOf(e.tableName as never));
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    expect(entries[0].tableName).toBe('routines');
  });
});

describe('3.2: onay bekleyen silme, veriyi koruyan seçenekler', () => {
  async function phoneWithSessions(server: FakeSyncServer, n: number) {
    const a = await phone();
    const r = await newRoutine(a.db, 'R', 1);
    for (let i = 0; i < n; i++) await workout(a.db, r);
    await expectOk(sync(a, server));
    return a;
  }

  it('gönderme yönü, "Buluttan geri getir": silinenler telefona geri iniyor, bulutta hiçbir şey silinmiyor', async () => {
    const server = new FakeSyncServer();
    const a = await phoneWithSessions(server, DELETE_CONFIRM_LIMIT + 1);
    const before = await synced(a.db);
    await a.db.delete(workoutSessions);
    expect(await sync(a, server)).toMatchObject({ status: 'blocked' });

    await restoreDeletedFromCloud(a.db);
    await expectOk(sync(a, server));
    expect(await synced(a.db)).toEqual(before);
    expect(server.rows(A, 'workout_sessions')).toHaveLength(DELETE_CONFIRM_LIMIT + 1);
    expect(await outboxCount(a.db)).toBe(0);
  });

  it('çekme yönü, "Bu telefondakileri koru": bu telefondakiler buluta yeniden gidiyor, öbür telefona da geri geliyor', async () => {
    const server = new FakeSyncServer();
    const a = await phoneWithSessions(server, DELETE_CONFIRM_LIMIT + 1);
    const b = await phone();
    await expectOk(sync(b, server));
    const kept = await synced(b.db);

    await a.db.delete(workoutSessions);
    await expectOk(sync(a, server, A, true));
    server.advance(60_000);

    const blocked = await sync(b, server);
    expect(blocked).toMatchObject({
      status: 'blocked',
      issue: { kind: 'needs_confirmation', direction: 'pull', sessions: 51, routines: 0 },
    });
    const issue = (await getSyncStatus(b.db)).issue;
    if (issue?.kind !== 'needs_confirmation') throw new Error('onay bekliyor olmalı');
    expect(issue.ids?.sessions).toHaveLength(51);

    await keepLocalCopies(b.db, issue.ids!);
    server.advance(60_000);
    await expectOk(sync(b, server));
    expect(await synced(b.db)).toEqual(kept);
    expect(server.rows(A, 'workout_sessions')).toHaveLength(51);

    server.advance(60_000);
    await expectOk(sync(a, server));
    expect(await synced(a.db)).toEqual(kept);
  });
});

describe('3.1: hesap değiştirme', () => {
  it('uyuşmazlıkta temizlik: eski hesabın verisi yeni hesaba gitmiyor, yeni hesabınki iniyor', async () => {
    const server = new FakeSyncServer();
    const other = await phone();
    await newRoutine(other.db, 'B rutini');
    await expectOk(sync(other, server, B));

    const a = await phone();
    await newRoutine(a.db, 'A rutini');
    await expectOk(sync(a, server, A));
    expect(await sync(a, server, B)).toMatchObject({ status: 'blocked', issue: { kind: 'owner_mismatch' } });

    // "Bu telefonu yeni hesapla kullan": yedek alındı → temizlik → eşitleme
    await wipeUserData(a.db);
    await expectOk(sync(a, server, B));
    expect((await a.db.select().from(routines)).map((r) => r.name)).toEqual(['B rutini']);
    expect(server.rows(B, 'routines').map((r) => r.name)).toEqual(['B rutini']);
    expect(server.rows(A, 'routines').map((r) => r.name)).toEqual(['A rutini']);
    expect((await readSyncState(a.db))!.ownerUserId).toBe(B);
  });
});

describe('BÖLÜM 4: hesap silindikten sonra', () => {
  it('takip kapanıyor, telefondaki veri kalıyor; yeni hesapla girişte uyuşmazlık çıkmıyor', async () => {
    const server = new FakeSyncServer();
    const a = await phone();
    const r = await newRoutine(a.db);
    await workout(a.db, r);
    await expectOk(sync(a, server, A));
    await a.db.update(routines).set({ name: 'bekleyen' });
    const before = await synced(a.db);

    await resetSyncAfterAccountDeleted(a.db);
    expect(await readSyncState(a.db)).toMatchObject({
      tracking: false,
      ownerUserId: null,
      pullCursor: null,
      lastSyncAt: null,
      lastError: null,
    });
    expect(await a.db.select().from(syncOutbox)).toEqual([]);
    expect(await synced(a.db)).toEqual(before);

    // Takip kapalı: yazmalar giden kutusuna düşmüyor
    await newRoutine(a.db, 'sonra');
    expect(await outboxCount(a.db)).toBe(0);

    // Yeni hesap: telefon verisi o hesaba yükleniyor
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expectOk(sync(a, server, B));
    warn.mockRestore();
    expect(server.rows(B, 'routines')).toHaveLength(2);
    expect(newId).toBeTruthy();
  });
});
