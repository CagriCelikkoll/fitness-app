/**
 * notify — Supabase Edge Function (v3.3). Database Webhook'tan çağrılır:
 *
 * - announcements INSERT → o salonun üyelerine (yazar hariç)
 * - class_exceptions INSERT / UPDATE / DELETE → o derse katılacağını
 *   söyleyenlere (iptal, değişiklik, geri alma)
 * - trainer_students INSERT / UPDATE (v3.6a) → yeni istek öğrenciye,
 *   kabul hocaya (tercih filtresi yok, kişiye özel)
 * - program_assignments INSERT (v3.6b) → program atanan öğrenciye
 * - gym_programs UPDATE (v3.6b) → sürüm arttıysa atanmış aktif
 *   öğrencilere (kişiye özel, tercih filtresi yok)
 *
 * Tercihi kapalı olana gitmez; Expo "DeviceNotRegistered" derse token
 * silinir. Kararlar ve metinler `logic.ts`'te (saf, Vitest ile test
 * ediliyor); burada yalnızca veritabanı ve Expo çağrıları.
 *
 * Gizli değişkenler (Supabase panelinde Edge Functions → Secrets):
 * - NOTIFY_SECRET: webhook'un `x-notify-secret` başlığıyla aynı
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: Supabase kendisi veriyor.
 *   Service role key yalnızca burada; uygulamaya girmez.
 *
 * Dağıtım: `npx supabase functions deploy notify --no-verify-jwt`
 * (kimlik doğrulama NOTIFY_SECRET ile).
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  EXPO_PUSH_URL,
  announcementContent,
  buildMessages,
  chunk,
  classChangeContent,
  invalidTokens,
  isUpcomingClass,
  parseWebhook,
  programContent,
  programUpdateRecipients,
  recipientTokens,
  trainerContent,
  trainerRecipient,
  type ExpoMessage,
  type NotifyEvent,
  type PrefsRow,
  type ProgramEvent,
  type TokenRow,
} from './logic.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Büyük `in (...)` listelerini parça parça sorgula */
async function selectIn<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  ids: readonly string[]
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from(table).select(columns).in(column, ids.slice(i, i + 200));
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

async function tokensFor(
  db: SupabaseClient,
  userIds: string[],
  kind: 'announcements' | 'classChanges' | 'personal',
  excludeUserId: string | null
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const [prefs, tokens] = await Promise.all([
    selectIn<PrefsRow>(db, 'notification_prefs', 'user_id, notify_announcements, notify_class_changes', 'user_id', userIds),
    selectIn<TokenRow>(db, 'push_tokens', 'token, user_id', 'user_id', userIds),
  ]);
  return recipientTokens(userIds, { kind, excludeUserId, prefs, tokens });
}

async function planProgram(db: SupabaseClient, event: ProgramEvent): Promise<ExpoMessage[]> {
  const { data: program, error } = await db
    .from('gym_programs')
    .select('id, gym_id, author_id, name, archived_at')
    .eq('id', event.programId)
    .maybeSingle();
  if (error) throw error;
  if (!program || program.archived_at) return [];

  let authorName: string | null = null;
  if (program.author_id) {
    const { data: profile, error: pErr } = await db
      .from('profiles')
      .select('display_name')
      .eq('id', program.author_id)
      .maybeSingle();
    if (pErr) throw pErr;
    authorName = profile?.display_name ?? null;
  }

  let recipients: string[] = [];
  if (event.change === 'assigned') {
    recipients = event.studentId ? [event.studentId] : [];
  } else if (program.author_id) {
    const { data: assigned, error: aErr } = await db
      .from('program_assignments')
      .select('student_id')
      .eq('program_id', program.id)
      .is('removed_at', null);
    if (aErr) throw aErr;
    const ids = (assigned ?? []).map((r: { student_id: string }) => r.student_id);
    if (ids.length === 0) return [];
    const active = await selectIn<{ student_id: string; trainer_id: string; gym_id: string; status: string }>(
      db,
      'trainer_students',
      'student_id, trainer_id, gym_id, status',
      'student_id',
      ids
    );
    recipients = programUpdateRecipients(
      ids,
      active
        .filter((l) => l.status === 'active' && l.trainer_id === program.author_id && l.gym_id === program.gym_id)
        .map((l) => l.student_id)
    );
  }
  const tokens = await tokensFor(db, recipients, 'personal', null);
  const resolved: ProgramEvent = { ...event, gymId: program.gym_id };
  return buildMessages(tokens, resolved, programContent(resolved, { programName: program.name, authorName }));
}

async function plan(db: SupabaseClient, event: NotifyEvent): Promise<ExpoMessage[]> {
  if (event.kind === 'program') return planProgram(db, event);

  if (event.kind === 'trainer') {
    const { data, error } = await db
      .from('profiles')
      .select('id, display_name')
      .in('id', [event.trainerId, event.studentId]);
    if (error) throw error;
    const nameOf = (id: string) =>
      ((data ?? []) as { id: string; display_name: string | null }[]).find((p) => p.id === id)?.display_name ?? null;
    const tokens = await tokensFor(db, [trainerRecipient(event)], 'personal', null);
    const content = trainerContent(event, { trainerName: nameOf(event.trainerId), studentName: nameOf(event.studentId) });
    return buildMessages(tokens, event, content);
  }

  if (event.kind === 'announcement') {
    const { data, error } = await db.from('gym_members').select('user_id').eq('gym_id', event.gymId);
    if (error) throw error;
    const ids = (data ?? []).map((r: { user_id: string }) => r.user_id);
    const tokens = await tokensFor(db, ids, 'announcements', event.authorId);
    return buildMessages(tokens, event, announcementContent(event));
  }

  const { data: template, error: tErr } = await db
    .from('class_templates')
    .select('name, start_time')
    .eq('id', event.templateId)
    .maybeSingle();
  if (tErr) throw tErr;
  // Ders silinmiş (cascade ile gelen DELETE): bildirilecek bir şey yok
  if (!template) return [];
  const now = Date.now();
  if (!isUpcomingClass(event, template, now)) return [];

  const { data, error } = await db
    .from('class_rsvps')
    .select('user_id')
    .eq('template_id', event.templateId)
    .eq('date', event.date);
  if (error) throw error;
  const ids = (data ?? []).map((r: { user_id: string }) => r.user_id);
  const tokens = await tokensFor(db, ids, 'classChanges', null);
  return buildMessages(tokens, event, classChangeContent(event, template, now));
}

async function send(db: SupabaseClient, messages: ExpoMessage[]): Promise<{ sent: number; removed: number }> {
  let removed = 0;
  for (const batch of chunk(messages)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[notify] Expo yanıtı', res.status, JSON.stringify(body));
      continue;
    }
    const invalid = invalidTokens(batch, body);
    if (invalid.length > 0) {
      const { error } = await db.from('push_tokens').delete().in('token', invalid);
      if (error) console.error('[notify] Geçersiz token silinemedi', error.message);
      else removed += invalid.length;
    }
  }
  return { sent: messages.length, removed };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const secret = Deno.env.get('NOTIFY_SECRET');
  if (!secret || req.headers.get('x-notify-secret') !== secret) return json({ error: 'unauthorized' }, 401);

  const event = parseWebhook(await req.json().catch(() => null));
  if (!event) return json({ skipped: true });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const messages = await plan(db, event);
    if (messages.length === 0) return json({ sent: 0 });
    return json(await send(db, messages));
  } catch (err) {
    console.error('[notify] HATA', err);
    return json({ error: 'failed' }, 500);
  }
});
