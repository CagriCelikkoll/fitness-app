/**
 * Hoca–öğrenci bağı (v3.6a): durum geçişleri, metinler, izin düğmesi,
 * "Öğrenci ekle" durumları, bildirim olayları ve metinleri, uygulama ile
 * sunucu sözleşmesi (rıza sürümü, hoca unvanı, push verisi).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_TRAINER,
  buildMessages,
  parseWebhook,
  recipientTokens,
  trainerContent,
  trainerRecipient,
  trainerTitle as serverTrainerTitle,
  type TrainerEvent,
} from '../supabase/functions/notify/logic';
import { classifyAccountError } from '@/lib/auth';
import { pushTarget } from '@/lib/push';
import {
  TRAINER_CONSENT_VERSION,
  canDo,
  canGiveConsent,
  candidateState,
  consentText,
  consentTitle,
  linkDateText,
  linksAsStudent,
  linksAsTrainer,
  nextStatus,
  parseTrainerLinks,
  pendingRequestsFor,
  requestCardText,
  sortByName,
  studentLabel,
  trainerTitle,
  trainersOfStudent,
  type TrainerLink,
} from '@/lib/trainers';

const ROOT = path.resolve(__dirname, '..');

const link = (over: Partial<TrainerLink> = {}): TrainerLink => ({
  id: 'l1',
  gymId: 'g1',
  gymName: 'Euphoria',
  trainerId: 't1',
  trainerName: 'Duygu',
  studentId: 's1',
  studentName: 'Ayşe',
  status: 'pending',
  requestedAt: '2026-10-12T09:00:00Z',
  respondedAt: null,
  consentedAt: null,
  ...over,
});

describe('durum geçişleri', () => {
  it('istek: kabul → active, red → declined; yalnızca pending iken', () => {
    expect(nextStatus('pending', 'accept')).toBe('active');
    expect(nextStatus('pending', 'decline')).toBe('declined');
    expect(nextStatus('active', 'accept')).toBeNull();
    expect(nextStatus('declined', 'accept')).toBeNull();
  });

  it('bitirme: pending / active → ended; kapanmış bağ bitirilemez', () => {
    expect(nextStatus('pending', 'end')).toBe('ended');
    expect(nextStatus('active', 'end')).toBe('ended');
    expect(nextStatus('ended', 'end')).toBeNull();
    expect(nextStatus('declined', 'end')).toBeNull();
  });

  it('kim ne yapabilir: kabul / red yalnızca öğrenci; bitirme hoca ya da öğrenci', () => {
    const l = link();
    expect(canDo('accept', l, 's1')).toBe(true);
    expect(canDo('accept', l, 't1')).toBe(false);
    expect(canDo('decline', l, 'admin')).toBe(false);
    expect(canDo('end', l, 't1')).toBe(true);
    expect(canDo('end', l, 's1')).toBe(true);
    expect(canDo('end', l, 'admin')).toBe(false);
    expect(canDo('accept', link({ status: 'active' }), 's1')).toBe(false);
    expect(canDo('end', link({ status: 'ended' }), 's1')).toBe(false);
    expect(canDo('end', l, null)).toBe(false);
  });
});

describe('izin ekranı', () => {
  it('"İzin ver" kutu işaretlenmeden pasif; işlem sürerken pasif', () => {
    expect(canGiveConsent(false, false)).toBe(false);
    expect(canGiveConsent(true, false)).toBe(true);
    expect(canGiveConsent(true, true)).toBe(false);
  });

  it('başlık ve rıza metni (KVKK v2 "Hocayla paylaşım")', () => {
    expect(consentTitle('Duygu')).toBe('Duygu Hoca seninle antrenman takibi yapmak istiyor.');
    const t = consentText('Euphoria', 'Duygu');
    expect(t).toContain('Euphoria hocası Duygu ile paylaşılmasına');
    expect(t).toContain("Salon Üye Aydınlatma Metni'ni okuyarak açık rıza veriyorum");
    expect(t).toContain('Kaldırdığım ağırlıkların, setlerimin ve vücut ölçülerimin paylaşılmadığını');
    expect(t).toContain('geri aldığımda hocanın erişiminin sona ereceğini biliyorum');
    expect(consentText(null, null)).toContain('Salon hocası ile');
  });

  it('rıza sürümü sunucudakiyle aynı', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/migrations/0010_trainers.sql'), 'utf8');
    expect(sql).toContain(`select '${TRAINER_CONSENT_VERSION}'::text;`);
  });
});

describe('metinler', () => {
  it('hoca unvanı', () => {
    expect(trainerTitle('Duygu')).toBe('Duygu Hoca');
    expect(trainerTitle('  Hakan Hoca ')).toBe('Hakan Hoca');
    expect(trainerTitle('hakan hoca')).toBe('hakan hoca');
    expect(trainerTitle(null)).toBe('Hocan');
    expect(studentLabel(null)).toBe('Adı girilmemiş üye');
  });

  it('uygulama ve bildirim aynı unvanı kullanıyor', () => {
    for (const n of ['Duygu', 'Hakan Hoca', '', null, ' Ece ']) {
      expect(serverTrainerTitle(n)).toBe(trainerTitle(n));
    }
  });

  it('ana sayfa istek kartı', () => {
    expect(requestCardText(link())).toBe('Duygu Hoca seni öğrencisi olarak eklemek istiyor.');
  });

  it('satır tarihi: aktifse izin tarihinden beri, bekliyorsa istek tarihi (salon saatiyle)', () => {
    const now = Date.parse('2026-10-18T10:00:00Z');
    expect(linkDateText(link(), now)).toBe('İstek: 12 Ekim');
    expect(linkDateText(link({ status: 'active', consentedAt: '2026-10-13T22:30:00Z' }), now)).toBe(
      '14 Ekim tarihinden beri'
    );
    expect(linkDateText(link({ requestedAt: null }), now)).toBe('İstek bekliyor');
  });
});

describe('listeler', () => {
  const links = [
    link({ id: 'a', studentId: 's1', studentName: 'Zeynep', status: 'active' }),
    link({ id: 'b', studentId: 's2', studentName: null }),
    link({ id: 'c', trainerId: 't2', studentId: 's1', status: 'pending' }),
    link({ id: 'd', gymId: 'g2', studentId: 's3', studentName: 'Ali', status: 'active' }),
  ];

  it('hoca kendi bağlarını, salona göre', () => {
    expect(linksAsTrainer(links, 't1').map((l) => l.id)).toEqual(['a', 'b', 'd']);
    expect(linksAsTrainer(links, 't1', 'g1').map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('öğrenciye gelen bekleyen istekler ve yöneticinin "Hocası"', () => {
    expect(pendingRequestsFor(links, 's1').map((l) => l.id)).toEqual(['c']);
    expect(linksAsStudent(links, 's1').map((l) => l.id)).toEqual(['a', 'c']);
    expect(trainersOfStudent(links, 's1').map((l) => l.id)).toEqual(['a']);
  });

  it('"Öğrenci ekle" durumları', () => {
    expect(candidateState('t1', 't1', links)).toBe('self');
    expect(candidateState('s1', 't1', links)).toBe('active');
    expect(candidateState('s2', 't1', links)).toBe('pending');
    expect(candidateState('s9', 't1', links)).toBe('available');
    // Başka hocanın isteği bu hocayı etkilemez
    expect(candidateState('s1', 't2', links)).toBe('pending');
    expect(candidateState('s3', 't2', links)).toBe('available');
  });

  it('ada göre sıralama, adsızlar sonda', () => {
    expect(sortByName(links, (l) => l.studentName).map((l) => l.studentName)).toEqual(['Ali', 'Ayşe', 'Zeynep', null]);
  });

  it('sunucu satırları', () => {
    const rows = [
      {
        id: 'x',
        gym_id: 'g',
        gym_name: 'Salon',
        trainer_id: 't',
        trainer_name: ' ',
        student_id: 's',
        student_name: 'Ayşe',
        status: 'active',
        requested_at: '2026-10-01T00:00:00Z',
        responded_at: null,
        consented_at: '2026-10-02T00:00:00Z',
      },
      { id: 'bozuk', status: 'active' },
      { id: 'y', gym_id: 'g', trainer_id: 't', student_id: 's', status: 'garip' },
    ];
    expect(parseTrainerLinks(rows)).toEqual([
      {
        id: 'x',
        gymId: 'g',
        gymName: 'Salon',
        trainerId: 't',
        trainerName: null,
        studentId: 's',
        studentName: 'Ayşe',
        status: 'active',
        requestedAt: '2026-10-01T00:00:00Z',
        respondedAt: null,
        consentedAt: '2026-10-02T00:00:00Z',
      },
    ]);
    expect(parseTrainerLinks(null)).toEqual([]);
  });

  it('sunucu hataları anlaşılır mesaja dönüyor', () => {
    expect(classifyAccountError({ message: 'student_not_member', code: 'P0001' })).toBe('student_not_member');
    expect(classifyAccountError({ message: 'trainer_already_linked', code: 'P0001' })).toBe('trainer_already_linked');
    expect(classifyAccountError({ message: 'trainer_self', code: 'P0001' })).toBe('trainer_self');
    expect(classifyAccountError({ message: 'trainer_link_closed', code: 'P0001' })).toBe('trainer_link_closed');
    expect(classifyAccountError({ message: 'consent_outdated', code: 'P0001' })).toBe('consent_outdated');
    expect(classifyAccountError({ message: 'permission denied for trainer request', code: '42501' })).toBe('forbidden');
  });
});

describe('bildirimler', () => {
  const record = { id: 'l1', gym_id: 'g1', trainer_id: 't1', student_id: 's1', status: 'pending' };
  const hook = (type: string, rec: unknown, old: unknown = null) => ({
    type,
    table: 'trainer_students',
    schema: 'public',
    record: rec,
    old_record: old,
  });

  it('yeni istek → öğrenciye; kabul → hocaya', () => {
    const req = parseWebhook(hook('INSERT', record)) as TrainerEvent;
    expect(req).toEqual({ kind: 'trainer', change: 'requested', linkId: 'l1', gymId: 'g1', trainerId: 't1', studentId: 's1' });
    expect(trainerRecipient(req)).toBe('s1');

    const acc = parseWebhook(hook('UPDATE', { ...record, status: 'active' }, record)) as TrainerEvent;
    expect(acc.change).toBe('accepted');
    expect(trainerRecipient(acc)).toBe('t1');
  });

  it('red, bitirme ve diğer güncellemeler bildirim değil', () => {
    expect(parseWebhook(hook('UPDATE', { ...record, status: 'declined' }, record))).toBeNull();
    expect(parseWebhook(hook('UPDATE', { ...record, status: 'ended' }, { ...record, status: 'active' }))).toBeNull();
    expect(parseWebhook(hook('UPDATE', { ...record, status: 'ended' }, record))).toBeNull();
    expect(parseWebhook(hook('INSERT', { ...record, status: 'active' }))).toBeNull();
    expect(parseWebhook(hook('DELETE', null, record))).toBeNull();
    expect(parseWebhook(hook('INSERT', { ...record, trainer_id: null }))).toBeNull();
  });

  it('metinler', () => {
    const req = parseWebhook(hook('INSERT', record)) as TrainerEvent;
    expect(trainerContent(req, { trainerName: 'Duygu', studentName: 'Ayşe' })).toEqual({
      title: 'Hoca isteği',
      body: 'Duygu Hoca seni öğrencisi olarak eklemek istiyor.',
    });
    expect(trainerContent(req, { trainerName: null, studentName: null }).body).toBe(
      'Bir hoca seni öğrencisi olarak eklemek istiyor.'
    );
    const acc = { ...req, change: 'accepted' as const };
    expect(trainerContent(acc, { trainerName: 'Duygu', studentName: 'Ayşe' })).toEqual({
      title: 'Yeni öğrenci',
      body: 'Ayşe isteğini kabul etti.',
    });
    expect(trainerContent(acc, { trainerName: null, studentName: ' ' }).body).toBe('Öğrencin isteğini kabul etti.');
  });

  it('tercih kapalı olsa da kişiye özel bildirim gider', () => {
    const prefs = [{ user_id: 's1', notify_announcements: false, notify_class_changes: false }];
    expect(recipientTokens(['s1'], { kind: 'personal', prefs, tokens: [{ user_id: 's1', token: 'T' }] })).toEqual(['T']);
  });

  it('kanal ve dokununca açılacak ekran (uygulamayla aynı sözleşme)', () => {
    const req = parseWebhook(hook('INSERT', record))!;
    const [m] = buildMessages(['T'], req, { title: 't', body: 'b' });
    expect(m.channelId).toBe(CHANNEL_TRAINER);
    expect(pushTarget(m.data)).toEqual({ pathname: '/trainer/consent', params: { id: 'l1' } });

    const acc = parseWebhook(hook('UPDATE', { ...record, status: 'active' }, record))!;
    const [n] = buildMessages(['T'], acc, { title: 't', body: 'b' });
    expect(pushTarget(n.data)).toEqual({ pathname: '/trainer/students', params: { gymId: 'g1' } });
    expect(pushTarget({ type: 'trainer-request', gymId: 'g1' })).toBeNull();
  });
});
