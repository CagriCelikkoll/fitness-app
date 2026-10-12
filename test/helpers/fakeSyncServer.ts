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
  /** Sunucu saati, ms; sıra için `seq` ile */
  serverAt: number;
  seq: number;
  deleted: boolean;
}

export type FailMode = 'before' | 'after';

const FUTURE_LIMIT_MS = 5 * 60_000;

export class FakeSyncServer {
  /**
   * Sunucu saati (ms). Gerçek saatten başlıyor: telefon tarafındaki
   * zamanlar SQLite trigger'ından (gerçek saat) geliyor; geride kalan bir
   * sunucu saati, 5 dk sınırıyla bütün düzenlemeleri aynı ana kırpardı.
   */
  nowMs = Date.now();
  private seq = 0;
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

  private tick(): { serverAt: number; seq: number } {
    this.seq += 1;
    return { serverAt: this.nowMs, seq: this.seq };
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
        rows.set(c.id, { row: { ...row, id: c.id }, clientAt: at, deleted: false, ...this.tick() });
        written += 1;
      } else {
        if (!existing || existing.deleted || at < existing.clientAt) continue;
        rows.set(c.id, { ...existing, clientAt: at, deleted: true, ...this.tick() });
        written += 1;
      }
    }
    return written;
  }

  pull(userId: string, req: PullRequest): PulledRow[] {
    const after = req.afterAt == null ? -Infinity : Date.parse(req.afterAt.split('#')[0]);
    const afterSeq = req.afterAt == null ? -Infinity : this.decodeSeq(req.afterAt);
    const until = Date.parse(req.until);
    return [...this.table(userId, req.table).entries()]
      .map(([id, r]) => ({ id, r }))
      .filter(({ id, r }) => {
        if (r.serverAt > until) return false;
        if (r.serverAt !== after) return r.serverAt > after;
        // Aynı milisaniye: sunucuda mikro saniye var; burada sıra numarası
        if (Number.isFinite(afterSeq)) return r.seq > afterSeq;
        return id > req.afterId;
      })
      .sort((a, b) => a.r.serverAt - b.r.serverAt || a.r.seq - b.r.seq)
      .slice(0, Math.min(Math.max(req.limit, 1), 1000))
      .map(({ id, r }) => ({
        id,
        serverUpdatedAt: this.encode(r.serverAt, r.seq),
        deleted: r.deleted,
        row: JSON.parse(JSON.stringify(r.row)) as ServerRow,
      }));
  }

  /**
   * Gerçek sunucunun mikro saniyeli zaman damgasını taklit: ISO metne
   * sıra numarası ekleniyor (`…Z#12`). Motor bunu yalnızca geri veriyor
   * ya da Date.parse ile örtüşme hesaplıyor; ikisi de çalışıyor.
   */
  private encode(ms: number, seq: number): string {
    return `${new Date(ms).toISOString()}#${seq}`;
  }

  private decodeSeq(s: string): number {
    const i = s.indexOf('#');
    return i < 0 ? -Infinity : Number(s.slice(i + 1));
  }

  transport(userId: string): SyncTransport & { readonly userId: string } {
    return {
      userId,
      serverTime: async () => {
        this.calls.push({ userId, op: 'serverTime' });
        return new Date(this.nowMs).toISOString();
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
