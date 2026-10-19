/**
 * Hoca–öğrenci bağı (v3.6a) — saf mantık + Supabase.
 * Sunucu: supabase/migrations/0010_trainers.sql. Kuralları sunucu
 * uyguluyor; buradaki kontroller yalnızca görünüm için.
 *
 * Durumlar: pending (hoca istedi) → active (öğrenci açık rıza verdi) ya
 * da declined; pending / active → ended (hoca ya da öğrenci bitirdi,
 * üyelik / hoca rolü sona erdi). Sunucu listesi yalnızca açık bağları
 * (pending, active) döndürüyor.
 *
 * Fonksiyonlar fırlatmaz; React ve Expo bilmez; test/trainers.test.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountResult } from '@/lib/account';
import { accountError, toAccountError } from '@/lib/auth';
import { gymNow } from '@/lib/classes';
import { formatEndDate } from '@/lib/gymAdmin';

/** Rıza metni sürümü; sunucudaki trainer_consent_version() ile aynı */
export const TRAINER_CONSENT_VERSION = '2026-10';

export type TrainerLinkStatus = 'pending' | 'active' | 'ended' | 'declined';

export interface TrainerLink {
  id: string;
  gymId: string;
  gymName: string | null;
  trainerId: string;
  trainerName: string | null;
  studentId: string;
  studentName: string | null;
  status: TrainerLinkStatus;
  requestedAt: string | null;
  respondedAt: string | null;
  consentedAt: string | null;
}

const STATUSES: readonly TrainerLinkStatus[] = ['pending', 'active', 'ended', 'declined'];

function isStatus(v: unknown): v is TrainerLinkStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

export function parseTrainerLinks(rows: unknown): TrainerLink[] {
  if (!Array.isArray(rows)) return [];
  const out: TrainerLink[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (
      typeof r?.id !== 'string' ||
      typeof r.gym_id !== 'string' ||
      typeof r.trainer_id !== 'string' ||
      typeof r.student_id !== 'string' ||
      !isStatus(r.status)
    ) {
      continue;
    }
    out.push({
      id: r.id,
      gymId: r.gym_id,
      gymName: text(r.gym_name),
      trainerId: r.trainer_id,
      trainerName: text(r.trainer_name),
      studentId: r.student_id,
      studentName: text(r.student_name),
      status: r.status,
      requestedAt: text(r.requested_at),
      respondedAt: text(r.responded_at),
      consentedAt: text(r.consented_at),
    });
  }
  return out;
}

// ============================================================================
// Durum geçişleri (sunucunun kurallarıyla aynı)
// ============================================================================

export type TrainerAction = 'accept' | 'decline' | 'end';

/** Bu kullanıcı bu bağda bu işlemi yapabilir mi */
export function canDo(action: TrainerAction, link: Pick<TrainerLink, 'status' | 'trainerId' | 'studentId'>, userId: string | null): boolean {
  if (!userId) return false;
  const isStudent = link.studentId === userId;
  const isTrainer = link.trainerId === userId;
  switch (action) {
    case 'accept':
    case 'decline':
      return isStudent && link.status === 'pending';
    case 'end':
      return (isStudent || isTrainer) && (link.status === 'pending' || link.status === 'active');
  }
}

export function nextStatus(status: TrainerLinkStatus, action: TrainerAction): TrainerLinkStatus | null {
  if (action === 'end') return status === 'pending' || status === 'active' ? 'ended' : null;
  if (status !== 'pending') return null;
  return action === 'accept' ? 'active' : 'declined';
}

// ============================================================================
// Görünüm
// ============================================================================

/** "Duygu" → "Duygu Hoca"; ad zaten "Hoca" ile bitiyorsa aynen; ad yoksa "Hocan" */
export function trainerTitle(name: string | null | undefined): string {
  const n = name?.trim();
  if (!n) return 'Hocan';
  return /\bhoca$/i.test(n) ? n : `${n} Hoca`;
}

export function studentLabel(name: string | null | undefined): string {
  return name?.trim() || 'Adı girilmemiş üye';
}

const BACK_VOWELS = 'aıouâû';
const FRONT_VOWELS = 'eiöüî';

/**
 * Özel isme yönelme eki (v3.6e): "Ayşe" → "Ayşe'ye", "Mehmet" → "Mehmet'e",
 * "Oğuz" → "Oğuz'a", "Ali Kaya" → "Ali Kaya'ya". Son kelimenin son ünlüsüne
 * göre (büyük ünlü uyumu); ünlüyle bitiyorsa kaynaştırma "y". Özel isimde
 * ünsüz yumuşaması yok ("Burak'a").
 */
export function dative(name: string): string {
  const n = name.trim();
  const word = (n.split(/\s+/).pop() ?? '').toLocaleLowerCase('tr');
  const vowels = [...word].filter((c) => BACK_VOWELS.includes(c) || FRONT_VOWELS.includes(c));
  const last = vowels[vowels.length - 1];
  if (!last) return `${n}'e`;
  const suffix = BACK_VOWELS.includes(last) ? 'a' : 'e';
  const endsWithVowel = [...word].pop() === last;
  return `${n}'${endsWithVowel ? 'y' : ''}${suffix}`;
}

/** Ana sayfadaki istek kartı */
export function requestCardText(link: Pick<TrainerLink, 'trainerName'>): string {
  return `${trainerTitle(link.trainerName)} seni öğrencisi olarak eklemek istiyor.`;
}

/** İzin ekranı: başlık ve rıza metni (KVKK v2 "Hocayla paylaşım") */
export function consentTitle(trainerName: string | null | undefined): string {
  return `${trainerTitle(trainerName)} seninle antrenman takibi yapmak istiyor.`;
}

export function consentText(gymName: string | null | undefined, trainerName: string | null | undefined): string {
  const gym = gymName?.trim() || 'Salon';
  const who = trainerName?.trim() ? `hocası ${trainerName.trim()}` : 'hocası';
  return (
    `Antrenmana geldiğim günlerin ve antrenman sürelerimin, devamımın ve programımın takibi amacıyla ${gym} ${who} ile paylaşılmasına, Salon Üye Aydınlatma Metni'ni okuyarak açık rıza veriyorum. ` +
    'Kaldırdığım ağırlıkların, setlerimin ve vücut ölçülerimin paylaşılmadığını, bu izni istediğim zaman geri alabileceğimi ve geri aldığımda hocanın erişiminin sona ereceğini biliyorum.'
  );
}

/** "İzin ver" düğmesi: kutu işaretli ve işlem sürmüyorsa */
export function canGiveConsent(checked: boolean, busy: boolean): boolean {
  return checked && !busy;
}

/** Hocanın "Öğrenci ekle" listesinde bir üyenin durumu */
export type CandidateState = 'self' | 'available' | 'pending' | 'active';

export function candidateState(
  memberUserId: string,
  trainerId: string,
  links: readonly Pick<TrainerLink, 'trainerId' | 'studentId' | 'status'>[]
): CandidateState {
  if (memberUserId === trainerId) return 'self';
  const link = links.find((l) => l.trainerId === trainerId && l.studentId === memberUserId);
  if (link?.status === 'active') return 'active';
  if (link?.status === 'pending') return 'pending';
  return 'available';
}

/** Bir kullanıcının bağları, rolüne göre */
export function linksAsTrainer(links: readonly TrainerLink[], userId: string | null, gymId?: string): TrainerLink[] {
  return links.filter((l) => l.trainerId === userId && (gymId == null || l.gymId === gymId));
}

export function linksAsStudent(links: readonly TrainerLink[], userId: string | null): TrainerLink[] {
  return links.filter((l) => l.studentId === userId);
}

/** Öğrenciye gelen, yanıt bekleyen istekler (ana sayfa kartı) */
export function pendingRequestsFor(links: readonly TrainerLink[], userId: string | null): TrainerLink[] {
  return linksAsStudent(links, userId).filter((l) => l.status === 'pending');
}

/** Yönetici: üyenin aktif hocaları ("Hocası: Duygu Hoca") */
export function trainersOfStudent(links: readonly TrainerLink[], studentId: string): TrainerLink[] {
  return links.filter((l) => l.studentId === studentId && l.status === 'active');
}

/**
 * Satırın alt metni: aktifse izin tarihi, bekliyorsa istek tarihi
 * ("12 Ekim'den beri", "İstek: 12 Ekim"). Salon takvimiyle.
 */
export function linkDateText(link: Pick<TrainerLink, 'status' | 'requestedAt' | 'consentedAt'>, nowMs: number): string {
  const iso = link.status === 'active' ? link.consentedAt : link.requestedAt;
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return link.status === 'active' ? 'Öğrenci' : 'İstek bekliyor';
  const day = formatEndDate(gymNow(ms).date, nowMs);
  return link.status === 'active' ? `${day} tarihinden beri` : `İstek: ${day}`;
}

/** Ada göre sıralı (adsızlar sonda) */
export function sortByName<T>(list: readonly T[], nameOf: (item: T) => string | null): T[] {
  return [...list].sort((a, b) => {
    const x = nameOf(a);
    const y = nameOf(b);
    if (x && !y) return -1;
    if (!x && y) return 1;
    return (x ?? '').localeCompare(y ?? '', 'tr');
  });
}

// ============================================================================
// Supabase
// ============================================================================

const ok = <T>(value: T): AccountResult<T> => ({ ok: true, value });
const err = <T>(e: unknown): AccountResult<T> => ({ ok: false, error: toAccountError(e) });

async function run<T>(
  client: SupabaseClient | null,
  fn: (c: SupabaseClient) => Promise<AccountResult<T>>
): Promise<AccountResult<T>> {
  if (!client) return { ok: false, error: accountError('not_configured') };
  try {
    return await fn(client);
  } catch (e) {
    console.error('[TRAINERS] HATA:', e);
    return err(e);
  }
}

/** Görebildiğim açık bağlar (hoca, öğrenci ya da yönetici olarak); gymId verilirse o salon */
export function fetchTrainerLinks(client: SupabaseClient | null, gymId: string | null = null) {
  return run<TrainerLink[]>(client, async (c) => {
    const { data, error } = await c.rpc('trainer_links', { p_gym_id: gymId });
    if (error) return err(error);
    return ok(parseTrainerLinks(data));
  });
}

export function requestStudent(client: SupabaseClient | null, gymId: string, studentId: string) {
  return run<string>(client, async (c) => {
    const { data, error } = await c.rpc('request_student', { p_gym_id: gymId, p_student_id: studentId });
    if (error) return err(error);
    return ok(String(data));
  });
}

export function respondTrainerRequest(client: SupabaseClient | null, linkId: string, accept: boolean) {
  return run<null>(client, async (c) => {
    const { error } = await c.rpc('respond_trainer_request', {
      p_id: linkId,
      p_accept: accept,
      p_consent_version: accept ? TRAINER_CONSENT_VERSION : null,
    });
    return error ? err(error) : ok(null);
  });
}

export function endTrainerLink(client: SupabaseClient | null, linkId: string) {
  return run<null>(client, async (c) => {
    const { error } = await c.rpc('end_trainer_link', { p_id: linkId });
    return error ? err(error) : ok(null);
  });
}
