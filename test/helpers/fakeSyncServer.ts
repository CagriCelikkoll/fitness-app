/**
 * `supabase/migrations/0002_sync.sql`'deki RPC sözleşmesini (sync_push,
 * sync_pull, sync_server_time) bellekte taklit eden sahte sunucu.
 *
 * Saat elle ilerletilebiliyor (telefon saati senaryoları için) ve
 * istekler sayılıyor / bilerek düşürülebiliyor. Sözleşmenin gerçek SQL
 * ile aynı davrandığını test/syncServer.test.ts'teki ortak senaryo
 * denetliyor (aynı adımlar hem bunda hem PGlite'ta).
 */

import type {
  PulledRow,
  PullRequest,
  ServerRow,
  SyncChange,
  SyncTableName,
  SyncTransport,
} from '@/lib/sync/types';

interface StoredRow {
  row: ServerRow;
  clientAt: number;
  /** Sunucu saati, mikro saniye (Postgres gibi); kesin artan */
  serverMicros: number;
  deleted: boolean;
}

export type FailMode = 'before' | 'after';

const FUTURE_LIMIT_MS = 5 * 60_000;

/** PostgREST'in timestamptz biçimi: `2026-10-12T10:00:00.123456+00:00` */
function encodeMicros(micros: number): string {
  const ms = Math.floor(micros / 1000);
  const iso = new Date(ms).toISOString(); // …ss.mmmZ
  return `${iso.slice(0, -1)}${String(micros % 1000).padStart(3, '0')}+00:00`;
}

function decodeMicros(s: string): number {
  const ms = Date.parse(s);
  const frac = /\.(\d+)/.exec(s)?.[1] ?? '';
  const extra = frac.length > 3 ? Number(frac.slice(3, 6).padEnd(3, '0')) : 0;
  return ms * 1000 + extra;
}

export class FakeSyncServer {
  /**
   * Sunucu saati (ms). Gerçek saatten başlıyor: telefon tarafındaki
   * zamanlar SQLite trigger'ından (gerçek saat) geliyor; geride kalan bir
   * sunucu saati, 5 dk sınırıyla bütün düzenlemeleri aynı ana kırpardı.
   */
  nowMs = Date.now();
  private lastMicros = 0;
  private readonly data = new Map<string, Map<SyncTableName, Map<string, StoredRow>>>();
  /** Yapılan istekler: kullanıcı → işlem adı */
  readonly calls: { userId: string; op: 'serverTime' | 'push' | 'pull' }[] = [];
  private failures: { op: 'push' | 'pull'; mode: FailMode; after: number }[] = [];

  advance(ms: number): void {
    this.nowMs += ms;
  }

  /** Sonraki `op` isteğini düşür: 'before' sunucuya ulaşmadan, 'after' uyguladıktan sonra yanıt kaybolur */
  failNext(op: 'push' | 'pull', mode: FailMode, afterCalls = 0): void {
    this.failures.push({ op, mode, after: afterCalls });
  }

  private takeFailure(op: 'push' | 'pull'): FailMode | null {
    const i = this.failures.findIndex((f) => f.op === op);
    if (i < 0) return null;
    const f = this.failures[i];
    if (f.after > 0) {
      f.after -= 1;
      return null;
    }
    this.failures.splice(i, 1);
    return f.mode;
  }

  private table(userId: string, t: SyncTableName): Map<string, StoredRow> {
    let user = this.data.get(userId);
    if (!user) this.data.set(userId, (user = new Map()));
    let rows = user.get(t);
    if (!rows) user.set(t, (rows = new Map()));
    return rows;
  }

  /** Test kontrolü: kullanıcının bir tablodaki silinmemiş satırları */
  rows(userId: string, t: SyncTableName): ServerRow[] {
    return [...this.table(userId, t).values()].filter((r) => !r.deleted).map((r) => r.row);
  }

  stored(userId: string, t: SyncTableName, id: string): StoredRow | undefined {
    return this.table(userId, t).get(id);
  }

  /** clock_timestamp(): kesin artan mikro saniye */
  private tick(): number {
    this.lastMicros = Math.max(this.nowMs * 1000, this.lastMicros + 1);
    return this.lastMicros;
  }

  serverTimeText(): string {
    return encodeMicros(this.tick());
  }

  push(userId: string, changes: SyncChange[]): number {
    const payload = JSON.parse(JSON.stringify(changes)) as SyncChange[];
    const max = this.nowMs + FUTURE_LIMIT_MS;
    // Partide aynı id birden fazlaysa en yeni
    const latest = new Map<string, SyncChange>();
    for (const c of payload) {
      const key = `${c.t}:${c.id}`;
      const prev = latest.get(key);
      if (!prev || Date.parse(c.at) > Date.parse(prev.at)) latest.set(key, c);
    }
    let written = 0;
    for (const c of latest.values()) {
      const rows = this.table(userId, c.t);
      const at = Math.min(Date.parse(c.at), max);
      const existing = rows.get(c.id);
      if (c.row && typeof c.row === 'object') {
        if (existing && at < existing.clientAt) continue;
        const { user_id: _ignored, ...row } = c.row;
        rows.set(c.id, { row: { ...row, id: c.id }, clientAt: at, deleted: false, serverMicros: this.tick() });
        written += 1;
      } else {
        if (!existing || existing.deleted || at < existing.clientAt) continue;
        rows.set(c.id, { ...existing, clientAt: at, deleted: true, serverMicros: this.tick() });
        written += 1;
      }
    }
    return written;
  }

  /** sync_pull: (server_updated_at, id) > (afterAt, afterId) ve <= until */
  pull(userId: string, req: PullRequest): PulledRow[] {
    const after = req.afterAt == null ? -Infinity : decodeMicros(req.afterAt);
    const until = decodeMicros(req.until);
    return [...this.table(userId, req.table).entries()]
      .map(([id, r]) => ({ id, r }))
      .filter(({ id, r }) => {
        if (r.serverMicros > until) return false;
        if (r.serverMicros !== after) return r.serverMicros > after;
        return id > req.afterId;
      })
      .sort((a, b) => a.r.serverMicros - b.r.serverMicros || (a.id < b.id ? -1 : 1))
      .slice(0, Math.min(Math.max(req.limit, 1), 1000))
      .map(({ id, r }) => ({
        id,
        serverUpdatedAt: encodeMicros(r.serverMicros),
        deleted: r.deleted,
        row: JSON.parse(JSON.stringify(r.row)) as ServerRow,
      }));
  }

  transport(userId: string): SyncTransport & { readonly userId: string } {
    return {
      userId,
      serverTime: async () => {
        this.calls.push({ userId, op: 'serverTime' });
        return this.serverTimeText();
      },
      push: async (changes) => {
        this.calls.push({ userId, op: 'push' });
        const fail = this.takeFailure('push');
        if (fail === 'before') throw new TypeError('Network request failed');
        this.push(userId, changes);
        if (fail === 'after') throw new TypeError('Network request failed');
      },
      pull: async (req) => {
        this.calls.push({ userId, op: 'pull' });
        const fail = this.takeFailure('pull');
        if (fail) throw new TypeError('Network request failed');
        return this.pull(userId, req);
      },
    };
  }
}
