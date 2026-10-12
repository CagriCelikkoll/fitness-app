/**
 * Eşitleme motoru (v3.1b). React bilmez, ağ katmanı dışarıdan verilir
 * (`SyncTransport`); testte sahte sunucuyla, uygulamada
 * `supabaseTransport.ts` ile çalışır. Tasarım: docs/sync-tasarim.md
 * (madde 6, 7 ve Ek A).
 *
 * Bir eşitleme:
 * 1. Sahip kontrolü: telefondaki veri başka hesabınsa hiçbir istek yok.
 * 2. Takip kapalıysa aç (`startTracking`).
 * 3. Silme koruması (gönderme): 50'den fazla antrenman/rutin silinecekse
 *    dur, onay bekle.
 * 4. İlk gönderim: tablolar taranarak (giden kutusundan değil).
 * 5. Giden kutusu: 500'lük partiler; yarım antrenmanın kayıtları bekler.
 * 6. Çekme: imleçten sonrası, sunucu saatiyle. Silme koruması (çekme).
 *    Susturma açıkken tek transaction'da yazılır; gönderilmemiş yerel
 *    değişikliği olan satıra dokunulmaz.
 *
 * Her adım tekrarlanabilir: sunucu upsert'i idempotent, giden kutusu
 * kaydı yalnızca başarılı gönderimden sonra siliniyor, imleç yalnızca
 * çekme transaction'ı başarılı olursa ilerliyor.
 */

import { and, asc, count, eq, gt, inArray, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  exercises,
  sessionExercises,
  syncOutbox,
  syncState,
  workoutSessions,
  type SyncOutboxEntry,
} from '@/db/schema';
import { ACCOUNT_ERROR_MESSAGES, classifyAccountError, type AccountErrorKind } from '@/lib/auth';
import { readSyncState, startTracking, withSyncSuppressed } from '@/lib/syncState';

import {
  ROOT_TABLES,
  SYNC_TABLES,
  fromServerRow,
  syncTable,
  toServerRow,
  type SyncTableInfo,
} from './tables';
import type { PulledRow, SyncChange, SyncTableName, SyncTransport } from './types';

export const PUSH_BATCH_SIZE = 500;
export const PULL_PAGE_SIZE = 1000;
/** Tek eşitlemede bundan fazla antrenman/rutin silinecekse onay beklenir */
export const DELETE_CONFIRM_LIMIT = 50;
/** Aynı anda commit olan sunucu işlemleri için imlecin geri örtüşmesi */
export const PULL_OVERLAP_MS = 2 * 60_000;
/** Giden kutusu boşaltmada en fazla parti (sürekli değişen satıra karşı) */
const MAX_PUSH_ROUNDS = 200;

/**
 * Taramayla (ilk gönderim) giden satırların zamanı: en eski. Buluttaki
 * hiçbir sürümü ezmez; bulutta olmayanlar eklenir. Geri yüklenen eski
 * bir yedek, öbür telefondaki yeni düzenlemeleri bu yüzden geri alamaz.
 */
export const SCAN_CHANGE_AT = '1970-01-01T00:00:00.000Z';

/** Placeholder: çekilen satırın egzersizi bu telefonda yoksa (tasarım madde 4) */
export const UNKNOWN_EXERCISE_NAME = 'Bilinmeyen egzersiz';

// ============================================================================
// Durum
// ============================================================================

export type SyncIssue =
  | { kind: 'owner_mismatch'; message: string }
  | {
      kind: 'needs_confirmation';
      direction: 'push' | 'pull';
      deletes: number;
      message: string;
    }
  | { kind: 'error'; errorKind: AccountErrorKind; message: string };

export type SyncOutcome =
  | { status: 'ok'; pushed: number; pulled: number }
  | { status: 'blocked'; issue: SyncIssue }
  | { status: 'error'; issue: SyncIssue };

export const OWNER_MISMATCH_MESSAGE =
  'Bu telefondaki antrenmanlar başka bir hesaba ait. Eşitleme durduruldu.';

export function confirmationMessage(direction: 'push' | 'pull', deletes: number): string {
  return direction === 'push'
    ? `Bu telefonda ${deletes} antrenman ya da rutin silinmiş görünüyor. Buluttan da silinmeden önce onayın gerekiyor.`
    : `Buluttan ${deletes} antrenman ya da rutinin silinmesi geliyor. Bu telefona uygulanmadan önce onayın gerekiyor.`;
}

/** `sync_state.last_error` JSON olarak SyncIssue tutuyor */
export function parseSyncIssue(raw: string | null | undefined): SyncIssue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncIssue>;
    if (parsed && typeof parsed.kind === 'string' && typeof parsed.message === 'string') {
      return parsed as SyncIssue;
    }
  } catch {
    // eski / bozuk değer: düz metin hata say
  }
  return { kind: 'error', errorKind: 'unknown', message: raw };
}

export interface SyncStatus {
  tracking: boolean;
  ownerUserId: string | null;
  initialUploadDone: boolean;
  lastSyncAt: string | null;
  /** Giden kutusundaki kayıt sayısı (yarım antrenmanınkiler dahil) */
  pending: number;
  issue: SyncIssue | null;
}

export async function getSyncStatus(db: Db): Promise<SyncStatus> {
  const state = await readSyncState(db);
  const [{ n }] = await db.select({ n: count() }).from(syncOutbox);
  return {
    tracking: state?.tracking ?? false,
    ownerUserId: state?.ownerUserId ?? null,
    initialUploadDone: state?.initialUploadDone ?? false,
    lastSyncAt: state?.lastSyncAt ?? null,
    pending: n,
    issue: parseSyncIssue(state?.lastError),
  };
}

async function saveIssue(db: Db, issue: SyncIssue | null): Promise<void> {
  await db
    .update(syncState)
    .set({ lastError: issue ? JSON.stringify(issue) : null })
    .where(eq(syncState.id, 1));
}

// ============================================================================
// Giriş noktası
// ============================================================================

export interface SyncDeps {
  db: Db;
  transport: SyncTransport;
  /** Giriş yapmış hesap */
  userId: string;
  /** Silme korumasını bir kez geç (kullanıcı onayladı; arayüzü tur c) */
  confirmDeletes?: boolean;
  /** Test için saat */
  now?: () => Date;
}

let running: Promise<SyncOutcome> | null = null;

/**
 * Bir eşitleme. Aynı anda ikincisi başlamaz: çalışan varsa onun sonucu
 * döner (kilit). Hiç fırlatmaz; sorun `SyncOutcome` ve `sync_state`'te.
 */
export function runSync(deps: SyncDeps): Promise<SyncOutcome> {
  if (running) return running;
  running = syncOnce(deps).finally(() => {
    running = null;
  });
  return running;
}

/** Şu an bir eşitleme çalışıyor mu */
export function isSyncRunning(): boolean {
  return running != null;
}

async function syncOnce(deps: SyncDeps): Promise<SyncOutcome> {
  const { db, userId } = deps;
  const now = deps.now ?? (() => new Date());

  try {
    let state = await readSyncState(db);
    if (!state) throw new Error('sync_state satırı yok');

    if (state.ownerUserId != null && state.ownerUserId !== userId) {
      const issue: SyncIssue = { kind: 'owner_mismatch', message: OWNER_MISMATCH_MESSAGE };
      await saveIssue(db, issue);
      return { status: 'blocked', issue };
    }
    if (!state.tracking || state.ownerUserId == null) {
      await startTracking(db, userId);
      state = (await readSyncState(db))!;
    }

    // Gönderme yönünde silme koruması: hiçbir şey göndermeden önce
    if (!deps.confirmDeletes) {
      const deletes = await countPendingRootDeletes(db);
      if (deletes > DELETE_CONFIRM_LIMIT) {
        const issue: SyncIssue = {
          kind: 'needs_confirmation',
          direction: 'push',
          deletes,
          message: confirmationMessage('push', deletes),
        };
        await saveIssue(db, issue);
        return { status: 'blocked', issue };
      }
    }

    let pushed = 0;
    if (!state.initialUploadDone) {
      pushed += await uploadAll(db, deps.transport);
      await db.update(syncState).set({ initialUploadDone: true }).where(eq(syncState.id, 1));
    }
    pushed += await pushOutbox(db, deps.transport);

    const pull = await pullChanges(db, deps.transport, {
      cursor: state.pullCursor,
      confirmDeletes: deps.confirmDeletes ?? false,
      now,
    });
    if (pull.status === 'blocked') {
      await saveIssue(db, pull.issue);
      return pull;
    }
    return { status: 'ok', pushed, pulled: pull.pulled };
  } catch (err) {
    console.warn('[SYNC] Eşitlenemedi:', err);
    const errorKind = classifyAccountError(err);
    const issue: SyncIssue = {
      kind: 'error',
      errorKind,
      message: ACCOUNT_ERROR_MESSAGES[errorKind],
    };
    try {
      await saveIssue(db, issue);
    } catch {
      // durum yazılamadıysa da sonuç dönsün
    }
    return { status: 'error', issue };
  }
}

// ============================================================================
// Gönderme
// ============================================================================

/** Giden kutusunda, satırı yerelde artık olmayan antrenman/rutin kayıtları */
export async function countPendingRootDeletes(db: Db): Promise<number> {
  let total = 0;
  for (const name of ROOT_TABLES) {
    const t = syncTable(name)!;
    const [{ n }] = await db
      .select({ n: count() })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tableName, name),
          notExists(db.select({ one: sql`1` }).from(t.table).where(eq(t.idColumn, syncOutbox.rowId)))
        )
      );
    total += n;
  }
  return total;
}

/** Giden kutusundan bekletilmeyen ilk `limit` kayıt (yarım antrenmanınkiler bekler) */
export async function readSendableOutbox(db: Db, limit: number): Promise<SyncOutboxEntry[]> {
  const rows = await db
    .select({ entry: syncOutbox })
    .from(syncOutbox)
    .leftJoin(workoutSessions, eq(workoutSessions.id, syncOutbox.sessionId))
    .where(
      or(
        isNull(syncOutbox.sessionId),
        isNull(workoutSessions.id), // antrenman silinmiş: silme kaydı gider
        isNotNull(workoutSessions.endedAt)
      )
    )
    .orderBy(asc(syncOutbox.changedAt), asc(syncOutbox.tableName), asc(syncOutbox.rowId))
    .limit(limit);
  return rows.map((r) => r.entry);
}

async function localRows(
  db: Db,
  t: SyncTableInfo,
  ids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = (await db.select().from(t.table).where(inArray(t.idColumn, chunk))) as Record<
      string,
      unknown
    >[];
    for (const row of rows) found.set(row.id as string, row);
  }
  return found;
}

/** Giden kutusunu boşaltır. @returns gönderilen kayıt sayısı */
export async function pushOutbox(db: Db, transport: SyncTransport): Promise<number> {
  let sent = 0;
  for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
    const entries = await readSendableOutbox(db, PUSH_BATCH_SIZE);
    if (entries.length === 0) break;

    const changes: SyncChange[] = [];
    for (const t of SYNC_TABLES) {
      const mine = entries.filter((e) => e.tableName === t.name);
      if (mine.length === 0) continue;
      const rows = await localRows(
        db,
        t,
        mine.map((e) => e.rowId)
      );
      for (const e of mine) {
        const local = rows.get(e.rowId);
        changes.push({
          t: t.name,
          id: e.rowId,
          at: e.changedAt,
          row: local ? toServerRow(t, local) : null,
        });
      }
    }

    if (changes.length > 0) await transport.push(changes);

    // Yalnızca gönderdiğimiz sürüm: arada yeniden değişen kayıt kalır
    await db.transaction(async (tx) => {
      for (const e of entries) {
        await tx
          .delete(syncOutbox)
          .where(
            and(
              eq(syncOutbox.tableName, e.tableName),
              eq(syncOutbox.rowId, e.rowId),
              eq(syncOutbox.changedAt, e.changedAt)
            )
          );
      }
    });
    sent += changes.length;
    if (entries.length < PUSH_BATCH_SIZE) break;
  }
  return sent;
}

/**
 * İlk gönderim: tablolar taranarak, id sırasıyla 500'lük partiler.
 * Bitmemiş antrenmanın ağacı atlanıyor (o giden kutusundan gider).
 * Yarıda kesilirse baştan taranır; sunucu upsert'i idempotent.
 */
export async function uploadAll(db: Db, transport: SyncTransport): Promise<number> {
  let sent = 0;
  for (const t of SYNC_TABLES) {
    let afterId = '';
    for (;;) {
      const page = await scanPage(db, t, afterId);
      if (page.length === 0) break;
      await transport.push(
        page.map((row) => ({
          t: t.name,
          id: row.id as string,
          at: SCAN_CHANGE_AT,
          row: toServerRow(t, row),
        }))
      );
      sent += page.length;
      afterId = page[page.length - 1].id as string;
      if (page.length < PUSH_BATCH_SIZE) break;
    }
  }
  return sent;
}

async function scanPage(
  db: Db,
  t: SyncTableInfo,
  afterId: string
): Promise<Record<string, unknown>[]> {
  const idAfter = gt(t.idColumn, afterId);
  const finished = isNotNull(workoutSessions.endedAt);
  const select = () => db.select({ row: t.table as never }).from(t.table);
  let rows: { row: Record<string, unknown> }[];

  switch (t.name) {
    case 'routines':
    case 'routine_exercises':
      rows = (await db.select().from(t.table).where(idAfter).orderBy(asc(t.idColumn)).limit(PUSH_BATCH_SIZE)).map(
        (row) => ({ row: row as Record<string, unknown> })
      );
      break;
    case 'workout_sessions':
      rows = (
        await db
          .select()
          .from(workoutSessions)
          .where(and(idAfter, finished))
          .orderBy(asc(t.idColumn))
          .limit(PUSH_BATCH_SIZE)
      ).map((row) => ({ row: row as Record<string, unknown> }));
      break;
    case 'session_exercises':
    case 'cardio_segments': {
      const sessionIdColumn = t.columns.sessionId;
      rows = await select()
        .innerJoin(workoutSessions, eq(workoutSessions.id, sessionIdColumn))
        .where(and(idAfter, finished))
        .orderBy(asc(t.idColumn))
        .limit(PUSH_BATCH_SIZE);
      break;
    }
    case 'sets':
      rows = await select()
        .innerJoin(sessionExercises, eq(sessionExercises.id, t.columns.sessionExerciseId))
        .innerJoin(workoutSessions, eq(workoutSessions.id, sessionExercises.sessionId))
        .where(and(idAfter, finished))
        .orderBy(asc(t.idColumn))
        .limit(PUSH_BATCH_SIZE);
      break;
  }
  return rows.map((r) => r.row);
}

// ============================================================================
// Çekme
// ============================================================================

type PullResult = { status: 'ok'; pulled: number } | { status: 'blocked'; issue: SyncIssue };

/**
 * İmleçten sonraki değişiklikleri indirir ve uygular. Önce hepsi
 * indiriliyor (silme koruması sayabilsin, yazma tek transaction olsun);
 * bir yıllık geçmiş ~6.500 satır, bellekte sorun değil.
 */
export async function pullChanges(
  db: Db,
  transport: SyncTransport,
  options: { cursor: string | null; confirmDeletes: boolean; now: () => Date }
): Promise<PullResult> {
  const until = await transport.serverTime();
  const startAt =
    options.cursor != null
      ? new Date(Date.parse(options.cursor) - PULL_OVERLAP_MS).toISOString()
      : null;

  const byTable = new Map<SyncTableName, PulledRow[]>();
  for (const t of SYNC_TABLES) {
    const all: PulledRow[] = [];
    let afterAt = startAt;
    let afterId = '';
    for (;;) {
      const page = await transport.pull({
        table: t.name,
        afterAt,
        afterId,
        until,
        limit: PULL_PAGE_SIZE,
      });
      all.push(...page);
      if (page.length < PULL_PAGE_SIZE) break;
      afterAt = page[page.length - 1].serverUpdatedAt;
      afterId = page[page.length - 1].id;
    }
    byTable.set(t.name, all);
  }

  if (!options.confirmDeletes) {
    const deletes = await countIncomingRootDeletes(db, byTable);
    if (deletes > DELETE_CONFIRM_LIMIT) {
      return {
        status: 'blocked',
        issue: {
          kind: 'needs_confirmation',
          direction: 'pull',
          deletes,
          message: confirmationMessage('pull', deletes),
        },
      };
    }
  }

  let applied = 0;
  await db.transaction(async (tx) => {
    await withSyncSuppressed(tx, async () => {
      applied = await applyPulled(tx as unknown as Db, byTable);
    });
    await tx
      .update(syncState)
      .set({ pullCursor: until, lastSyncAt: options.now().toISOString(), lastError: null })
      .where(eq(syncState.id, 1));
  });
  return { status: 'ok', pulled: applied };
}

async function pendingKeys(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ t: syncOutbox.tableName, id: syncOutbox.rowId })
    .from(syncOutbox);
  return new Set(rows.map((r) => `${r.t}:${r.id}`));
}

async function existingIds(db: Db, t: SyncTableInfo, ids: string[]): Promise<Set<string>> {
  return new Set((await localRows(db, t, [...new Set(ids)])).keys());
}

async function countIncomingRootDeletes(
  db: Db,
  byTable: Map<SyncTableName, PulledRow[]>
): Promise<number> {
  const pending = await pendingKeys(db);
  let total = 0;
  for (const name of ROOT_TABLES) {
    const t = syncTable(name)!;
    const ids = (byTable.get(name) ?? [])
      .filter((r) => r.deleted && !pending.has(`${name}:${r.id}`))
      .map((r) => r.id);
    total += (await existingIds(db, t, ids)).size;
  }
  return total;
}

/** Susturma açıkken, transaction içinde çağrılır. @returns yazılan/silinen satır */
async function applyPulled(db: Db, byTable: Map<SyncTableName, PulledRow[]>): Promise<number> {
  const pending = await pendingKeys(db);
  const isPending = (t: SyncTableName, id: string) => pending.has(`${t}:${id}`);
  let applied = 0;

  // Yazma: ebeveynden çocuğa
  for (const t of SYNC_TABLES) {
    const incoming = (byTable.get(t.name) ?? []).filter((r) => !r.deleted && !isPending(t.name, r.id));
    if (incoming.length === 0) continue;
    // Sayfalar örtüşebilir (imleç geri örtüşmesi): her id bir kez, en yeni
    const latest = new Map<string, PulledRow>();
    for (const r of incoming) latest.set(r.id, r);
    let rows = [...latest.values()].map((r) => fromServerRow(t, r.row, r.id));

    // Ebeveyni bu telefonda olmayan satır FK'yi bozar, bütün eşitleme
    // düşerdi: zorunlu bağda atla, isteğe bağlıda (rutin) boşalt.
    for (const parent of t.parents) {
      const parentTable = syncTable(parent.table)!;
      const refs = rows.map((r) => r[parent.column]).filter((v): v is string => typeof v === 'string');
      const present = await existingIds(db, parentTable, refs);
      rows = rows.flatMap((r) => {
        const ref = r[parent.column];
        if (ref == null || (typeof ref === 'string' && present.has(ref))) return [r];
        if (parent.nullable) return [{ ...r, [parent.column]: null }];
        console.warn(`[SYNC] ${t.name} ${String(r.id)}: ebeveyni yok, atlandı`);
        return [];
      });
    }
    if (t.exerciseColumn) await ensureExercises(db, rows.map((r) => r[t.exerciseColumn!]));

    await upsertRows(db, t, rows);
    applied += rows.length;
  }

  // Silme: çocuktan ebeveyne; yerel cascade kalanını temizler
  for (const t of [...SYNC_TABLES].reverse()) {
    const ids = (byTable.get(t.name) ?? [])
      .filter((r) => r.deleted && !isPending(t.name, r.id))
      .map((r) => r.id);
    for (let i = 0; i < ids.length; i += 500) {
      const deleted = await db
        .delete(t.table)
        .where(inArray(t.idColumn, ids.slice(i, i + 500)))
        .returning({ id: t.idColumn });
      applied += deleted.length;
    }
  }
  return applied;
}

async function ensureExercises(db: Db, refs: unknown[]): Promise<void> {
  const ids = [...new Set(refs.filter((v): v is string => typeof v === 'string'))];
  if (ids.length === 0) return;
  const present = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(inArray(exercises.id, ids.slice(i, i + 500)));
    rows.forEach((r) => present.add(r.id));
  }
  const missing = ids.filter((id) => !present.has(id));
  if (missing.length === 0) return;
  console.warn('[SYNC] Bu telefonda olmayan egzersiz, yer tutucu eklendi:', missing);
  await db
    .insert(exercises)
    .values(
      missing.map((id) => ({
        id,
        name: UNKNOWN_EXERCISE_NAME,
        nameTr: UNKNOWN_EXERCISE_NAME,
        primaryMuscles: '[]',
        category: 'strength',
        isCustom: true,
      }))
    )
    .onConflictDoNothing();
}

/**
 * INSERT … ON CONFLICT(id) DO UPDATE. INSERT OR REPLACE olmaz: satırı
 * silip yeniden yazar, cascade ile çocukları (setleri) götürürdü.
 */
async function upsertRows(db: Db, t: SyncTableInfo, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const keys = Object.keys(t.columns);
  const set = Object.fromEntries(
    keys
      .filter((k) => k !== 'id')
      .map((k) => [k, sql.raw(`excluded.${JSON.stringify(t.columns[k].name)}`)])
  );
  const size = Math.max(1, Math.floor(900 / keys.length));
  for (let i = 0; i < rows.length; i += size) {
    await db
      .insert(t.table)
      .values(rows.slice(i, i + size) as never)
      .onConflictDoUpdate({ target: t.idColumn, set: set as never });
  }
}
