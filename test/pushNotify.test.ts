/**
 * Push gönderimi (v3.3) — notify Edge Function'ının saf mantığı:
 * webhook → olay, alıcılar (yazar hariç, tercih filtresi), metinler,
 * Expo mesajları, geçersiz token'lar. Uygulama tarafıyla sözleşme
 * (veri biçimi → açılacak ekran) da burada.
 */

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_ANNOUNCEMENTS,
  CHANNEL_CLASS_CHANGES,
  announcementContent,
  buildMessages,
  chunk,
  classChangeContent,
  dayText,
  invalidTokens,
  isUpcomingClass,
  parseWebhook,
  recipientTokens,
  truncate,
  type ClassChangeEvent,
} from '../supabase/functions/notify/logic';
import { PUSH_CHANNELS, pushTarget } from '@/lib/push';

/** Salonda (UTC+3) verilen yerel an */
const istanbul = (iso: string) => Date.parse(`${iso}+03:00`);
const NOW = istanbul('2026-10-14T12:00:00'); // Çarşamba

const GYM = '11111111-1111-1111-1111-111111111111';
const TPL = '22222222-2222-2222-2222-222222222222';

const exceptionRow = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  template_id: TPL,
  gym_id: GYM,
  date: '2026-10-15',
  kind: 'cancelled',
  start_time: null,
  instructor_name: null,
  note: null,
  ...over,
});

const webhook = (table: string, type: string, record: unknown, old_record: unknown = null) => ({
  type,
  table,
  schema: 'public',
  record,
  old_record,
});

describe('webhook → olay', () => {
  it('yeni duyuru', () => {
    expect(
      parseWebhook(
        webhook('announcements', 'INSERT', { id: 'a1', gym_id: GYM, author_id: 'u1', title: 'Bayram', body: 'Kapalıyız.' })
      )
    ).toEqual({ kind: 'announcement', gymId: GYM, announcementId: 'a1', authorId: 'u1', title: 'Bayram', body: 'Kapalıyız.' });
  });

  it('duyuru düzenleme / silme bildirim değil', () => {
    const row = { id: 'a1', gym_id: GYM, author_id: 'u1', title: 'T', body: 'B' };
    expect(parseWebhook(webhook('announcements', 'UPDATE', row, row))).toBeNull();
    expect(parseWebhook(webhook('announcements', 'DELETE', null, row))).toBeNull();
  });

  it('ders iptali ve değişikliği', () => {
    expect(parseWebhook(webhook('class_exceptions', 'INSERT', exceptionRow({ note: 'Hoca hasta' })))).toMatchObject({
      kind: 'class',
      change: 'cancelled',
      templateId: TPL,
      date: '2026-10-15',
      note: 'Hoca hasta',
    });
    expect(
      parseWebhook(
        webhook('class_exceptions', 'INSERT', exceptionRow({ kind: 'changed', start_time: '19:00:00', instructor_name: 'Ayşe' }))
      )
    ).toMatchObject({ change: 'changed', startTime: '19:00:00', instructorName: 'Ayşe', previousStartTime: null });
  });

  it('güncellemede yalnızca anlamlı değişiklik; önceki saat korunur', () => {
    const before = exceptionRow({ kind: 'changed', start_time: '19:00:00' });
    expect(parseWebhook(webhook('class_exceptions', 'UPDATE', { ...before, updated_at: 'x' }, before))).toBeNull();
    expect(
      parseWebhook(webhook('class_exceptions', 'UPDATE', exceptionRow({ kind: 'changed', start_time: '20:00:00' }), before))
    ).toMatchObject({ change: 'changed', startTime: '20:00:00', previousStartTime: '19:00:00' });
    expect(parseWebhook(webhook('class_exceptions', 'UPDATE', exceptionRow(), before))).toMatchObject({ change: 'cancelled' });
  });

  it('istisna silindi → programda (geri alındı)', () => {
    expect(parseWebhook(webhook('class_exceptions', 'DELETE', null, exceptionRow()))).toMatchObject({
      change: 'restored',
      date: '2026-10-15',
    });
  });

  it('başka tablo / şema / bozuk gövde', () => {
    expect(parseWebhook(webhook('class_templates', 'INSERT', { id: TPL }))).toBeNull();
    expect(parseWebhook({ ...webhook('announcements', 'INSERT', { id: 'a', gym_id: GYM, title: 'T', body: 'B' }), schema: 'auth' })).toBeNull();
    expect(parseWebhook(null)).toBeNull();
    expect(parseWebhook('x')).toBeNull();
    expect(parseWebhook(webhook('class_exceptions', 'INSERT', exceptionRow({ date: '15.10.2026' })))).toBeNull();
  });
});

describe('alıcılar', () => {
  const tokens = [
    { user_id: 'author', token: 'T-author' },
    { user_id: 'a', token: 'T-a1' },
    { user_id: 'a', token: 'T-a2' },
    { user_id: 'b', token: 'T-b' },
    { user_id: 'c', token: 'T-c' },
    { user_id: 'stranger', token: 'T-x' },
  ];
  const prefs = [
    { user_id: 'b', notify_announcements: false, notify_class_changes: true },
    { user_id: 'c', notify_announcements: true, notify_class_changes: false },
  ];

  it('duyuru: yazar hariç, tercihi kapalı olan hariç, satırı olmayan açık', () => {
    expect(
      recipientTokens(['author', 'a', 'b', 'c', 'd'], { kind: 'announcements', excludeUserId: 'author', prefs, tokens })
    ).toEqual(['T-a1', 'T-a2', 'T-c']);
  });

  it('ders değişikliği: yalnızca adaylar (katılacaklar), kendi tercihine göre', () => {
    expect(recipientTokens(['b', 'c'], { kind: 'classChanges', prefs, tokens })).toEqual(['T-b']);
  });

  it('aday olmayanın token’ı asla', () => {
    expect(recipientTokens([], { kind: 'announcements', prefs, tokens })).toEqual([]);
  });
});

describe('metinler', () => {
  const tpl = { name: 'Pilates', start_time: '18:00:00' };
  const ev = (over: Partial<ClassChangeEvent>): ClassChangeEvent => ({
    kind: 'class',
    change: 'cancelled',
    gymId: GYM,
    templateId: TPL,
    date: '2026-10-15',
    startTime: null,
    instructorName: null,
    note: null,
    previousStartTime: null,
    ...over,
  });

  it('gün: bugün / yarın / tarih (salon saatiyle)', () => {
    expect(dayText('2026-10-14', NOW)).toBe('Bugün');
    expect(dayText('2026-10-15', NOW)).toBe('Yarın');
    expect(dayText('2026-10-16', NOW)).toBe('16 Ekim Cuma');
    // UTC 21:30 = İstanbul 00:30 (15 Ekim)
    expect(dayText('2026-10-15', Date.parse('2026-10-14T21:30:00Z'))).toBe('Bugün');
  });

  it('iptal, değişiklik, geri alma', () => {
    expect(classChangeContent(ev({ note: 'Hoca hasta' }), tpl, NOW)).toEqual({
      title: 'Pilates iptal',
      body: 'Yarın 18:00 dersi yapılmayacak. Not: Hoca hasta',
    });
    expect(classChangeContent(ev({ change: 'changed', startTime: '19:30:00', instructorName: 'Ayşe' }), tpl, NOW)).toEqual({
      title: 'Pilates dersinde değişiklik',
      body: 'Yarın 18:00 yerine 19:30. Hoca: Ayşe.',
    });
    expect(classChangeContent(ev({ change: 'changed', instructorName: 'Ayşe' }), tpl, NOW).body).toBe('Yarın 18:00. Hoca: Ayşe.');
    expect(
      classChangeContent(ev({ change: 'changed', startTime: '20:00:00', previousStartTime: '19:00:00' }), tpl, NOW).body
    ).toBe('Yarın 19:00 yerine 20:00.');
    expect(classChangeContent(ev({ change: 'restored' }), tpl, NOW)).toEqual({
      title: 'Pilates programda',
      body: 'Yarın 18:00 dersi normal programında yapılacak.',
    });
  });

  it('duyuru: başlık ve kısaltılmış gövde', () => {
    const long = 'kelime '.repeat(60);
    const c = announcementContent({ kind: 'announcement', gymId: GYM, announcementId: 'a', authorId: null, title: 'Bayram', body: long });
    expect(c.title).toBe('Bayram');
    expect([...c.body].length).toBeLessThanOrEqual(160);
    expect(c.body.endsWith('…')).toBe(true);
    expect(truncate('  kısa\n metin ')).toBe('kısa metin');
  });

  it('geçmiş derse bildirim yok', () => {
    expect(isUpcomingClass(ev({ date: '2026-10-14' }), { name: 'X', start_time: '11:00' }, NOW)).toBe(false);
    expect(isUpcomingClass(ev({ date: '2026-10-14' }), { name: 'X', start_time: '13:00' }, NOW)).toBe(true);
    // Saat öne çekildi ve yeni saat geçti; eski saat henüz gelmedi → yine haber ver
    expect(
      isUpcomingClass(ev({ date: '2026-10-14', change: 'changed', startTime: '11:00' }), { name: 'X', start_time: '13:00' }, NOW)
    ).toBe(true);
  });
});

describe('Expo mesajları', () => {
  it('kanal ve veri; dokununca açılacak ekran uygulamayla uyumlu', () => {
    const ann = parseWebhook(webhook('announcements', 'INSERT', { id: 'a1', gym_id: GYM, title: 'T', body: 'B' }))!;
    const [m] = buildMessages(['T1'], ann, announcementContent(ann as never));
    expect(m).toMatchObject({ to: 'T1', channelId: CHANNEL_ANNOUNCEMENTS, sound: 'default', priority: 'high' });
    expect(pushTarget(m.data)).toEqual({ pathname: '/announcements' });

    const cls = parseWebhook(webhook('class_exceptions', 'INSERT', exceptionRow()))!;
    const [c] = buildMessages(['T2'], cls, { title: 't', body: 'b' });
    expect(c.channelId).toBe(CHANNEL_CLASS_CHANGES);
    expect(pushTarget(c.data)).toEqual({
      pathname: '/classes',
      params: { date: '2026-10-15', focus: `${TPL}:2026-10-15`, gymId: GYM },
    });
  });

  it('uygulamanın kurduğu kanallar gönderilenlerle aynı', () => {
    expect(PUSH_CHANNELS.map((c) => c.id).sort()).toEqual([CHANNEL_ANNOUNCEMENTS, CHANNEL_CLASS_CHANGES].sort());
    expect(PUSH_CHANNELS.map((c) => c.name)).toEqual(['Duyurular', 'Dersler']);
  });

  it('100’lük paketler', () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map((p) => p.length)).toEqual([100, 100, 50]);
  });

  it('DeviceNotRegistered olan token’lar silinecek', () => {
    const messages = [{ to: 'A' }, { to: 'B' }, { to: 'C' }];
    expect(
      invalidTokens(messages, {
        data: [
          { status: 'ok', id: '1' },
          { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'y', details: { error: 'MessageRateExceeded' } },
        ],
      })
    ).toEqual(['B']);
    expect(invalidTokens(messages, null)).toEqual([]);
  });
});
