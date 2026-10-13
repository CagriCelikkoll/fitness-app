/**
 * Eşitleme motoru (v3.1b, v3.1c). React bilmez, ağ katmanı dışarıdan
 * verilir (`SyncTransport`); testte sahte sunucuyla, uygulamada
 * `supabaseTransport.ts` ile çalışır. Tasarım: docs/sync-tasarim.md
 * (madde 6, 7, Ek A, Ek B, Ek C).
 *
 * Bir eşitleme:
 * 1. Sahip kontrolü: telefondaki veri başka hesabınsa hiçbir istek yok.
 * 2. Takip kapalıysa aç (`startTracking`).
 * 3. Silme koruması (gönderme): 50'den fazla antrenman/rutin silinecekse
 *    dur, onay bekle.
 * 4. İlk gönderim: tablolar taranarak (giden kutusundan değil).
 * 5. Giden kutusu: 500'lük partiler, ebeveyn tablolar önce; yarım
 *    antrenmanın kayıtları bekler.
 * 6. Çekme: imleçten sonrası, sunucu saatiyle; bütün sayfalar toplanıp
 *    ebeveynden çocuğa uygulanır. Silme koruması (çekme). Susturma
 *    açıkken tek transaction'da yazılır; gönderilmemiş yerel değişikliği
 *    olan satıra dokunulmaz. Ebeveyni henüz gelmemiş satır bekletilir:
 *    imleç onun önüne geçmez, sonraki çekmede yeniden iner.
 *
 * Her adım tekrarlanabilir: sunucu upsert'i idempotent, giden kutusu
 * kaydı yalnızca başarılı gönderimden sonra siliniyor, imleç yalnızca
 * çekme transaction'ı başarılı olursa ilerliyor.
 */

import { and, asc, count, eq, gt, inArray, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  cardioSegments,
  exercises,
  routineExercises,
  sessionExercises,
  sets,
  syncOutbox,
  syncState,
  workoutSessions,
  type SyncOutboxEntry,
} from '@/db/schema';
import { ACCOUNT_ERROR_MESSAGES, classifyAccountError, type AccountErrorKind } from '@/lib/auth';
import { readSyncState, startTracking, withSyncSuppressed } from '@/lib/syncState';

import {
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
/**
 * Ebeveyni gelmeyen satır en fazla bu kadar bekletilir (sunucu saatiyle).
 * Sonra atlanır ve sayılır: imleç sonsuza kadar geride kalmasın.
 */
export const ORPHAN_WAIT_MS = 7 * 24 * 3600_000;
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

/** Silme korumasının saydığı kök kayıtlar */
export interface RootCounts {
  sessions: number;
  routines: number;
}

export type SyncIssue =
  | { kind: 'owner_mismatch'; message: string }
  | {
      kind: 'needs_confirmation';
      direction: 'push' | 'pull';
      deletes: number;
      sessions: number;
      routines: number;
      /** Çekme yönünde: silinmesi istenen ve bu telefonda duran kök kayıtlar */
      ids?: { sessions: string[]; routines: string[] };
      message: string;
    }
  /** detail: tanınmayan hatanın ham metni (cihazda teşhis için) */
  | { kind: 'error'; errorKind: AccountErrorKind; message: string; detail?: string }
  /** Eşitleme bitti ama bazı satırların ebeveyni gelmedi */
  | { kind: 'waiting_rows'; waiting: number; dropped: number; message: string };

export type SyncOutcome =
  | { status: 'ok'; pushed: number; pulled: number; waiting: number; dropped: number }
  | { status: 'blocked'; issue: SyncIssue }
  | { status: 'error'; issue: SyncIssue };

export const OWNER_MISMATCH_MESSAGE =
  'Bu telefondaki antrenmanlar başka bir hesaba ait. Eşitleme durduruldu.';

/** "3 antrenman ve 1 rutin", "52 antrenman" */
export function describeRoots(counts: RootCounts): string {
  const parts = [
    counts.sessions > 0 ? `${counts.sessions} antrenman` : null,
    counts.routines > 0 ? `${counts.routines} rutin` : null,
  ].filter((p): p is string => p != null);
  return parts.length > 0 ? parts.join(' ve ') : '0 kayıt';
}

export function confirmationMessage(direction: 'push' | 'pull', counts: RootCounts): string {
  const what = describeRoots(counts);
  return direction === 'push'
    ? `Bu telefonda ${what} silinmiş. Eşitleme durdu, buluttaki kopyalar duruyor.`
    : `Bulutta ${what} silinmiş (başka bir telefonda silinmiş olabilir). Eşitleme durdu, bu telefondakiler duruyor.`;
}

export function waitingMessage(waiting: number, dropped: number): string {
  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} kayıt, bağlı olduğu antrenman ya da rutin gelince eklenecek.`);
  if (dropped > 0) parts.push(`${dropped} kayıt, bağlı olduğu kayıt bulunamadığı için eklenemedi.`);
  return parts.join(' ');
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
  /** Gönderilmeyi bekleyen kayıt (yarım antrenmanınkiler hariç) */
  pending: number;
  /** Yarım antrenman bitince gidecek kayıtlar */
  held: number;
  /** Ebeveyni gelmediği için bekletilen / atlanan satırlar */
  waiting: number;
  dropped: number;
  issue: SyncIssue | null;
}

export async function getSyncStatus(db: Db): Promise<SyncStatus> {
  const state = await readSyncState(db);
  const [{ total }] = await db.select({ total: count() }).from(syncOutbox);
  const [{ sendable }] = await db
    .select({ sendable: count() })
    .from(syncOutbox)
    .leftJoin(workoutSessions, eq(workoutSessions.id, syncOutbox.sessionId))
    .where(sendableCondition());
  const issue = parseSyncIssue(state?.lastError);
  return {
    tracking: state?.tracking ?? false,
    ownerUserId: state?.ownerUserId ?? null,
    initialUploadDone: state?.initialUploadDone ?? false,
    lastSyncAt: state?.lastSyncAt ?? null,
    pending: sendable,
    held: total - sendable,
    waiting: issue?.kind === 'waiting_rows' ? issue.waiting : 0,
    dropped: issue?.kind === 'waiting_rows' ? issue.dropped : 0,
    issue,
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
  /** Silme korumasını bir kez geç (kullanıcı onayladı) */
  confirmDeletes?: boolean;
  /** Test için saat */
  now?: () => Date;
  /** Test için çekme sayfa büyüklüğü */
  pullPageSize?: number;
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
      const counts = await countPendingRootDeletes(db);
      const deletes = counts.sessions + counts.routines;
      if (deletes > DELETE_CONFIRM_LIMIT) {
        const issue: SyncIssue = {
          kind: 'needs_confirmation',
          direction: 'push',
          deletes,
          ...counts,
          message: confirmationMessage('push', counts),
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
      pageSize: deps.pullPageSize,
    });
    if (pull.status === 'blocked') {
      await saveIssue(db, pull.issue);
      return pull;
    }
    return { status: 'ok', pushed, ...pull.result };
  } catch (err) {
    console.warn('[SYNC] Eşitlenemedi:', err);
    const errorKind = classifyAccountError(err);
    const issue: SyncIssue = {
      kind: 'error',
      errorKind,
      message: ACCOUNT_ERROR_MESSAGES[errorKind],
      ...(errorKind === 'unknown' ? { detail: errorText(err) } : {}),
    };
    try {
      await saveIssue(db, issue);
    } catch {
      // durum yazılamadıysa da sonuç dönsün
    }
    return { status: 'error', issue };
  }
}

/** Hatanın kısa metni: "mesaj (kod)" */
export function errorText(err: unknown): string {
  const e = (err ?? {}) as { message?: unknown; code?: unknown; name?: unknown };
  const message = typeof e.message === 'string' ? e.message : String(err);
  const code = typeof e.code === 'string' && e.code !== '' ? ` (${e.code})` : '';
  return `${message}${code}`.slice(0, 200);
}

// ============================================================================
// Gönderme
// ============================================================================

/** Giden kutusunda, satırı yerelde artık olmayan antrenman/rutin kayıtları */
export async function countPendingRootDeletes(db: Db): Promise<RootCounts> {
  const countFor = async (name: SyncTableName) => {
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
    return n;
  };
  return { sessions: await countFor('workout_sessions'), routines: await countFor('routines') };
}

/** Yarım antrenmana ait olmayan kayıtlar (leftJoin workout_sessions ile) */
function sendableCondition() {
  return or(
    isNull(syncOutbox.sessionId),
    isNull(workoutSessions.id), // antrenman silinmiş: silme kaydı gider
    isNotNull(workoutSessions.endedAt)
  );
}

/** Ebeveyn tablolar önce: yarıda kesilen gönderim bulutta ebeveynsiz çocuk bırakmasın */
const TABLE_RANK = sql.raw(
  `case table_name ${SYNC_TABLES.map((t, i) => `when '${t.name}' then ${i}`).join(' ')} else 99 end`
);

/** Giden kutusundan bekletilmeyen ilk `limit` kayıt (yarım antrenmanınkiler bekler) */
export async function readSendableOutbox(db: Db, limit: number): Promise<SyncOutboxEntry[]> {
  const rows = await db
    .select({ entry: syncOutbox })
    .from(syncOutbox)
    .leftJoin(workoutSessions, eq(workoutSessions.id, syncOutbox.sessionId))
    .where(sendableCondition())
    .orderBy(TABLE_RANK, asc(syncOutbox.changedAt), asc(syncOutbox.rowId))
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

interface PullSummary {
  pulled: number;
  waiting: number;
  dropped: number;
}

type PullResult = { status: 'ok'; result: PullSummary } | { status: 'blocked'; issue: SyncIssue };

/**
 * İmleçten sonraki değişiklikleri indirir ve uygular. Önce bütün
 * tabloların bütün sayfaları indiriliyor, sonra ebeveynden çocuğa tek
 * transaction'da yazılıyor: aynı çekmede çocuğun ebeveyninden önceki
 * sayfada gelmesi sorun değil. Bir yıllık geçmiş ~6.500 satır, bellekte
 * sorun değil.
 */
export async function pullChanges(
  db: Db,
  transport: SyncTransport,
  options: { cursor: string | null; confirmDeletes: boolean; now: () => Date; pageSize?: number }
): Promise<PullResult> {
  const pageSize = options.pageSize ?? PULL_PAGE_SIZE;
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
      const page = await transport.pull({ table: t.name, afterAt, afterId, until, limit: pageSize });
      all.push(...page);
      if (page.length < pageSize) break;
      afterAt = page[page.length - 1].serverUpdatedAt;
      afterId = page[page.length - 1].id;
    }
    byTable.set(t.name, all);
  }

  if (!options.confirmDeletes) {
    const incoming = await incomingRootDeletes(db, byTable);
    const deletes = incoming.sessions.length + incoming.routines.length;
    if (deletes > DELETE_CONFIRM_LIMIT) {
      const counts = { sessions: incoming.sessions.length, routines: incoming.routines.length };
      return {
        status: 'blocked',
        issue: {
          kind: 'needs_confirmation',
          direction: 'pull',
          deletes,
          ...counts,
          ids: incoming,
          message: confirmationMessage('pull', counts),
        },
      };
    }
  }

  const untilMs = Date.parse(until);
  let summary: PullSummary = { pulled: 0, waiting: 0, dropped: 0 };
  await db.transaction(async (tx) => {
    let applied: Applied = { count: 0, waiting: [], dropped: 0 };
    await withSyncSuppressed(tx, async () => {
      applied = await applyPulled(tx as unknown as Db, byTable, untilMs);
    });
    // Bekletilen satır varsa imleç en eskisinin önüne geçmesin: sonraki
    // çekme (örtüşmeyle) onu yeniden indirir.
    const earliestWaiting = applied.waiting.reduce<string | null>(
      (min, r) => (min == null || Date.parse(r.serverUpdatedAt) < Date.parse(min) ? r.serverUpdatedAt : min),
      null
    );
    const issue: SyncIssue | null =
      applied.waiting.length > 0 || applied.dropped > 0
        ? {
            kind: 'waiting_rows',
            waiting: applied.waiting.length,
            dropped: applied.dropped,
            message: waitingMessage(applied.waiting.length, applied.dropped),
          }
        : null;
    await tx
      .update(syncState)
      .set({
        pullCursor: earliestWaiting ?? until,
        lastSyncAt: options.now().toISOString(),
        lastError: issue ? JSON.stringify(issue) : null,
      })
      .where(eq(syncState.id, 1));
    summary = { pulled: applied.count, waiting: applied.waiting.length, dropped: applied.dropped };
  });
  return { status: 'ok', result: summary };
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

/** Buluttan gelen ve bu telefonda duran antrenman/rutin silmeleri */
async function incomingRootDeletes(
  db: Db,
  byTable: Map<SyncTableName, PulledRow[]>
): Promise<{ sessions: string[]; routines: string[] }> {
  const pending = await pendingKeys(db);
  const idsFor = async (name: SyncTableName) => {
    const ids = (byTable.get(name) ?? [])
      .filter((r) => r.deleted && !pending.has(`${name}:${r.id}`))
      .map((r) => r.id);
    return [...(await existingIds(db, syncTable(name)!, ids))].sort();
  };
  return { sessions: await idsFor('workout_sessions'), routines: await idsFor('routines') };
}

interface Applied {
  count: number;
  waiting: PulledRow[];
  dropped: number;
}

/** Susturma açıkken, transaction içinde çağrılır */
async function applyPulled(
  db: Db,
  byTable: Map<SyncTableName, PulledRow[]>,
  untilMs: number
): Promise<Applied> {
  const pending = await pendingKeys(db);
  const isPending = (t: SyncTableName, id: string) => pending.has(`${t}:${id}`);
  const tombstoned = new Set(
    [...byTable.entries()].flatMap(([t, rows]) => rows.filter((r) => r.deleted).map((r) => `${t}:${r.id}`))
  );
  /** 7 günden uzun bekleyip atılanlar; çocukları da atılıp sayılır */
  const expired = new Set<string>();
  const result: Applied = { count: 0, waiting: [], dropped: 0 };

  // Yazma: ebeveynden çocuğa
  for (const t of SYNC_TABLES) {
    const incoming = (byTable.get(t.name) ?? []).filter((r) => !r.deleted && !isPending(t.name, r.id));
    if (incoming.length === 0) continue;
    // Sayfalar örtüşebilir (imleç geri örtüşmesi): her id bir kez, en yeni
    const latest = new Map<string, PulledRow>();
    for (const r of incoming) latest.set(r.id, r);
    let rows = [...latest.values()].map((r) => ({ pulled: r, local: fromServerRow(t, r.row, r.id) }));

    // Ebeveyni bu telefonda olmayan satır FK'yi bozar, bütün eşitleme
    // düşerdi. İsteğe bağlı bağ (rutin) boşaltılır. Zorunlu bağda:
    // - ebeveyn silinmişse (bulutta mezar taşı ya da burada silinip
    //   gönderilmeyi bekliyor) satır atılır;
    // - değilse ebeveyn henüz gelmemiştir (öbür telefonun gönderimi yarıda
    //   kalmış olabilir): satır bekletilir, imleç onun önüne geçmez;
    // - 7 günden uzun bekleyen atılır ve sayılır.
    for (const parent of t.parents) {
      const parentTable = syncTable(parent.table)!;
      const refs = rows
        .map((r) => r.local[parent.column])
        .filter((v): v is string => typeof v === 'string');
      const present = await existingIds(db, parentTable, refs);
      rows = rows.flatMap((r) => {
        const ref = r.local[parent.column];
        if (ref == null || (typeof ref === 'string' && present.has(ref))) return [r];
        if (parent.nullable) return [{ ...r, local: { ...r.local, [parent.column]: null } }];
        const key = `${parent.table}:${String(ref)}`;
        const self = `${t.name}:${r.pulled.id}`;
        if (tombstoned.has(key) || isPending(parent.table, String(ref))) {
          // Ebeveyn silinmiş: satır da gitmeli; çocukları (setler) da
          tombstoned.add(self);
        } else if (
          expired.has(key) ||
          untilMs - Date.parse(r.pulled.serverUpdatedAt) > ORPHAN_WAIT_MS
        ) {
          console.warn(`[SYNC] ${self}: ebeveyni 7 gündür gelmedi, atlandı`);
          expired.add(self);
          result.dropped += 1;
        } else {
          result.waiting.push(r.pulled);
        }
        return [];
      });
    }
    if (t.exerciseColumn) await ensureExercises(db, rows.map((r) => r.local[t.exerciseColumn!]));

    await upsertRows(
      db,
      t,
      rows.map((r) => r.local)
    );
    result.count += rows.length;
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
      result.count += deleted.length;
    }
  }
  return result;
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

// ============================================================================
// Onay bekleyen silmeler (v3.1c, 3.2): veriyi koruyan seçenekler
// ============================================================================

/**
 * Gönderme yönü, "Buluttan geri getir": bu telefonda silinmiş ve henüz
 * gönderilmemiş bütün silme kayıtları atılır, imleç sıfırlanır. Sonraki
 * eşitleme buluttaki her şeyi indirir; silinenler geri gelir.
 */
export async function restoreDeletedFromCloud(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const t of SYNC_TABLES) {
      await tx
        .delete(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tableName, t.name),
            notExists(tx.select({ one: sql`1` }).from(t.table).where(eq(t.idColumn, syncOutbox.rowId)))
          )
        );
    }
    await tx.update(syncState).set({ pullCursor: null, lastError: null }).where(eq(syncState.id, 1));
  });
}

/**
 * Çekme yönü, "Bu telefondakileri koru": buluttan silinmesi istenen
 * antrenman ve rutinler, bütün alt satırlarıyla şimdiki zamanla giden
 * kutusuna konur. Sonraki eşitleme onları buluta yeniden gönderir (son
 * yazan kazanır: mezar taşından yeni), ardından gelen çekmede silme yoktur.
 */
export async function keepLocalCopies(
  db: Db,
  ids: { sessions: string[]; routines: string[] },
  now: () => Date = () => new Date()
): Promise<number> {
  const at = now().toISOString();
  const entries: (typeof syncOutbox.$inferInsert)[] = [];
  const add = (tableName: SyncTableName, rowId: string, sessionId: string | null) =>
    entries.push({ tableName, rowId, sessionId, changedAt: at });

  const chunks = <T>(list: T[]) =>
    Array.from({ length: Math.ceil(list.length / 500) }, (_, i) => list.slice(i * 500, i * 500 + 500));

  for (const chunk of chunks(ids.routines)) {
    chunk.forEach((id) => add('routines', id, null));
    const res = await db
      .select({ id: routineExercises.id })
      .from(routineExercises)
      .where(inArray(routineExercises.routineId, chunk));
    res.forEach((r) => add('routine_exercises', r.id, null));
  }
  for (const chunk of chunks(ids.sessions)) {
    chunk.forEach((id) => add('workout_sessions', id, id));
    const ses = await db
      .select({ id: sessionExercises.id, sessionId: sessionExercises.sessionId })
      .from(sessionExercises)
      .where(inArray(sessionExercises.sessionId, chunk));
    ses.forEach((s) => add('session_exercises', s.id, s.sessionId));
    const sessionOf = new Map(ses.map((s) => [s.id, s.sessionId]));
    for (const seChunk of chunks(ses.map((s) => s.id))) {
      const setRows = await db
        .select({ id: sets.id, se: sets.sessionExerciseId })
        .from(sets)
        .where(inArray(sets.sessionExerciseId, seChunk));
      setRows.forEach((s) => add('sets', s.id, sessionOf.get(s.se) ?? null));
    }
    const cardio = await db
      .select({ id: cardioSegments.id, sessionId: cardioSegments.sessionId })
      .from(cardioSegments)
      .where(inArray(cardioSegments.sessionId, chunk));
    cardio.forEach((c) => add('cardio_segments', c.id, c.sessionId));
  }

  await db.transaction(async (tx) => {
    for (const batch of chunks(entries)) {
      await tx
        .insert(syncOutbox)
        .values(batch)
        .onConflictDoUpdate({
          target: [syncOutbox.tableName, syncOutbox.rowId],
          set: { changedAt: at },
        });
    }
    await tx.update(syncState).set({ lastError: null }).where(eq(syncState.id, 1));
  });
  return entries.length;
}
