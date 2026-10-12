/**
 * Motorun Supabase katmanı: üç RPC (supabase/migrations/0002_sync.sql).
 * Hata olursa fırlatır; motor yakalayıp `classifyAccountError` ile
 * sınıflandırıyor (internet yok / sunucu hatası …).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PulledRow, PullRequest, SyncChange, SyncTransport } from './types';

interface PullRpcRow {
  id: string;
  server_updated_at: string;
  deleted: boolean;
  data: Record<string, unknown>;
}

export function supabaseTransport(client: SupabaseClient): SyncTransport {
  return {
    async serverTime() {
      const { data, error } = await client.rpc('sync_server_time');
      if (error) throw error;
      return data as string;
    },

    async push(changes: SyncChange[]) {
      const { error } = await client.rpc('sync_push', { p_changes: changes });
      if (error) throw error;
    },

    async pull(request: PullRequest): Promise<PulledRow[]> {
      const { data, error } = await client.rpc('sync_pull', {
        p_table: request.table,
        p_after_at: request.afterAt,
        p_after_id: request.afterId,
        p_until: request.until,
        p_limit: request.limit,
      });
      if (error) throw error;
      return ((data ?? []) as PullRpcRow[]).map((r) => ({
        id: r.id,
        serverUpdatedAt: r.server_updated_at,
        deleted: r.deleted,
        row: r.data,
      }));
    },
  };
}
