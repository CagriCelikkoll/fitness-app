/**
 * Eşitleme (v3.1b) — motor ile sunucu arasındaki sözleşme.
 *
 * Sunucu tarafı: supabase/migrations/0002_sync.sql (`sync_push`,
 * `sync_pull`, `sync_server_time`). Testlerde aynı sözleşmeyi taklit
 * eden sahte sunucu: test/helpers/fakeSyncServer.ts.
 */

/** Eşitlenen tablolar, sunucudaki adlarıyla (SQLite'takiyle aynı) */
export type SyncTableName =
  | 'routines'
  | 'routine_exercises'
  | 'workout_sessions'
  | 'session_exercises'
  | 'sets'
  | 'cardio_segments';

/** Sunucudaki satır: SQLite sütun adları (snake_case) → değer */
export type ServerRow = Record<string, unknown>;

/** Gönderilen tek değişiklik. `row` null ise silme (mezar taşı). */
export interface SyncChange {
  t: SyncTableName;
  id: string;
  /** İstemci zamanı (ISO); son yazan kazanır kararında kullanılır */
  at: string;
  row: ServerRow | null;
}

export interface PullRequest {
  table: SyncTableName;
  /** Bu (zaman, id) çiftinden sonrası; null: baştan */
  afterAt: string | null;
  afterId: string;
  /** Üst sınır (sunucu saati) */
  until: string;
  limit: number;
}

export interface PulledRow {
  id: string;
  /** Sunucu saati; sayfalama için metin olarak aynen geri verilir */
  serverUpdatedAt: string;
  deleted: boolean;
  row: ServerRow;
}

export interface SyncTransport {
  serverTime(): Promise<string>;
  push(changes: SyncChange[]): Promise<void>;
  pull(request: PullRequest): Promise<PulledRow[]>;
}
