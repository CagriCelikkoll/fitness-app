/**
 * Salon geri bildirimi (v3.6d): form doğrulaması, durum geçişleri
 * (sunucuyla aynı), yazar etiketi (anonim), özet sayıları, fotoğraf boyutu,
 * bildirim olayları ve metinleri, push → ekran, gizlilik metni.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_FEEDBACK,
  FEEDBACK_CATEGORY_LABELS,
  buildMessages,
  feedbackContent,
  parseWebhook,
  type FeedbackEvent,
} from '../supabase/functions/notify/logic';
import { LEGAL_DOCUMENTS } from '@/content/legal';
import { classifyAccountError } from '@/lib/auth';
import {
  FEEDBACK_CATEGORIES,
  STATUS_NEXT,
  authorLabel,
  canSetStatus,
  counterText,
  excerpt,
  feedbackSummary,
  filterFeedback,
  fitWithin,
  parseFeedbackRows,
  photoObjectPath,
  summaryText,
  validateFeedback,
  type Feedback,
  type FeedbackStatus,
} from '@/lib/feedback';
import { PUSH_CHANNELS, pushTarget } from '@/lib/push';

const ROOT = path.resolve(__dirname, '..');
const GYM = '0b6f9f6e-1111-4222-8333-444455556666';
const ist = (local: string) => Date.parse(`${local}+03:00`);
const iso = (local: string) => new Date(ist(local)).toISOString();

const fb = (over: Partial<Feedback> = {}): Feedback => ({
  id: 'f1',
  gymId: GYM,
  category: 'equipment',
  body: 'Squat rack pimi eksik.',
  photoPath: null,
  anonymous: false,
  authorId: 'u1',
  authorName: 'Ayşe',
  status: 'new',
  reply: null,
  repliedAt: null,
  createdAt: iso('2026-10-10T10:00:00'),
  ...over,
});

describe('form', () => {
  it('kategori ve 5–1000 karakter', () => {
    expect(validateFeedback({ category: null, body: 'Yeterince uzun' })).toBe('Bir kategori seç.');
    expect(validateFeedback({ category: 'other', body: '  abc  ' })).toBe('En az 5 karakter yaz.');
    expect(validateFeedback({ category: 'other', body: 'x'.repeat(1001) })).toMatch(/En fazla 1000/);
    expect(validateFeedback({ category: 'cleanliness', body: 'Duşlar soğuk.' })).toBeNull();
    expect(counterText('  merhaba ')).toBe('7 / 1000');
  });

  it('sunucudaki sınırlar ve kategoriler aynı', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/migrations/0013_feedback.sql'), 'utf8');
    expect(sql).toContain('char_length(btrim(body)) between 5 and 1000');
    expect(sql).toContain(">= 5 then\n    raise exception 'feedback_daily_limit'");
    for (const c of FEEDBACK_CATEGORIES) expect(sql).toContain(`'${c.key}'`);
    expect(Object.fromEntries(FEEDBACK_CATEGORIES.map((c) => [c.key, c.label]))).toEqual(FEEDBACK_CATEGORY_LABELS);
    expect(classifyAccountError({ message: 'feedback_daily_limit' })).toBe('feedback_daily_limit');
  });
});

describe('durum geçişleri (sunucuyla aynı)', () => {
  it('izinli geçişler', () => {
    expect(canSetStatus('new', 'in_progress')).toBe(true);
    expect(canSetStatus('new', 'resolved')).toBe(true);
    expect(canSetStatus('in_progress', 'new')).toBe(true);
    expect(canSetStatus('resolved', 'in_progress')).toBe(true);
    expect(canSetStatus('resolved', 'new')).toBe(false);
    expect(canSetStatus('resolved', 'resolved')).toBe(true);
  });

  it('migration\'daki feedback_status_allowed ile aynı tablo', () => {
    const sql = readFileSync(path.join(ROOT, 'supabase/migrations/0013_feedback.sql'), 'utf8');
    for (const [from, tos] of Object.entries(STATUS_NEXT) as [FeedbackStatus, FeedbackStatus[]][]) {
      const list = tos.map((t) => `'${t}'`);
      const expected =
        list.length === 1 ? `(p_from = '${from}' and p_to = ${list[0]})` : `(p_from = '${from}' and p_to in (${list.join(', ')}))`;
      expect(sql).toContain(expected);
    }
  });
});

describe('yönetici görünümü', () => {
  it('yazar etiketi: anonimde ad yok', () => {
    expect(authorLabel(fb())).toBe('Ayşe');
    expect(authorLabel(fb({ anonymous: true }))).toBe('Anonim üye');
    expect(authorLabel(fb({ authorName: null }))).toBe('Adı girilmemiş üye');
    expect(authorLabel(fb({ authorName: null, authorId: null }))).toBe('Hesabı silinmiş üye');
  });

  it('anonim satırda sunucu yanlışlıkla kimlik gönderse bile uygulama göstermez', () => {
    const [row] = parseFeedbackRows([
      {
        id: 'f',
        gym_id: GYM,
        category: 'staff',
        body: 'Gece görevlisi kaba.',
        anonymous: true,
        author_id: 'u1',
        author_name: 'Ayşe',
        status: 'new',
        created_at: iso('2026-10-10T10:00:00'),
      },
    ]);
    expect(row.authorId).toBeNull();
    expect(row.authorName).toBeNull();
    expect(parseFeedbackRows([{ id: 'x', gym_id: GYM, category: 'uzay', body: 'abcde', status: 'new', created_at: 'x' }])).toEqual([]);
  });

  it('filtre ve en yeni üstte', () => {
    const list = [
      fb({ id: 'a', createdAt: iso('2026-10-01T10:00:00') }),
      fb({ id: 'b', status: 'resolved', createdAt: iso('2026-10-05T10:00:00') }),
      fb({ id: 'c', category: 'cleanliness', createdAt: iso('2026-10-07T10:00:00') }),
    ];
    expect(filterFeedback(list, { status: null, category: null }).map((f) => f.id)).toEqual(['c', 'b', 'a']);
    expect(filterFeedback(list, { status: 'new', category: null }).map((f) => f.id)).toEqual(['c', 'a']);
    expect(filterFeedback(list, { status: null, category: 'cleanliness' }).map((f) => f.id)).toEqual(['c']);
  });

  it('özet: bu ay (UTC+3), çözülen, yeni', () => {
    const now = ist('2026-10-20T12:00:00');
    const list = [
      fb({ createdAt: iso('2026-10-01T00:30:00'), status: 'resolved' }), // UTC'de 30 Eylül, salonda Ekim
      fb({ createdAt: iso('2026-10-12T10:00:00'), status: 'resolved' }),
      fb({ createdAt: iso('2026-10-15T10:00:00'), status: 'in_progress' }),
      fb({ createdAt: iso('2026-10-18T10:00:00'), status: 'new' }),
      fb({ createdAt: iso('2026-09-28T10:00:00'), status: 'new' }), // geçen ay ama hâlâ yeni
    ];
    const s = feedbackSummary(list, now);
    expect(s).toEqual({ month: 4, resolved: 2, fresh: 2 });
    expect(summaryText(s)).toBe('Bu ay 4 geri bildirim · 2 çözüldü · 2 yeni');
  });

  it('metnin başı kelime sınırında', () => {
    expect(excerpt('kısa metin')).toBe('kısa metin');
    const e = excerpt('Koşu bandının kemeri kayıyor ve hız düğmesi bazen tepki vermiyor, lütfen bakılsın, teşekkürler', 40);
    expect(e.endsWith('…')).toBe(true);
    expect([...e].length).toBeLessThanOrEqual(40);
  });
});

describe('fotoğraf', () => {
  it('uzun kenar en fazla 1024, büyütmez', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 768, height: 1024 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('yol salon klasöründe, rastgele ad, sunucu deseniyle uyumlu', () => {
    const p = photoObjectPath(GYM, 'a1b2-c3d4e5f6/..');
    expect(p).toBe(`${GYM}/a1b2-c3d4e5f6.jpg`);
    expect(/^[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,64}\.jpg$/.test(p)).toBe(true);
  });
});

describe('bildirim', () => {
  const rec = { id: 'f1', gym_id: GYM, category: 'equipment', author_id: 'u1', status: 'new', reply: null };

  it('yeni kayıt → yöneticilere, metin yok', () => {
    const e = parseWebhook({ type: 'INSERT', table: 'gym_feedback', schema: 'public', record: { ...rec, body: 'gizli metin' } });
    expect(e).toEqual({ kind: 'feedback', change: 'new', feedbackId: 'f1', gymId: GYM, category: 'equipment', authorId: 'u1' });
    const content = feedbackContent(e as FeedbackEvent);
    expect(content.body).toBe('Yeni geri bildirim: Ekipman.');
    expect(JSON.stringify(content)).not.toContain('gizli metin');
  });

  it('yanıt yazıldı ya da çözüldü → yazara; başka değişiklik yok', () => {
    const base = { type: 'UPDATE', table: 'gym_feedback', schema: 'public' };
    const replied = parseWebhook({ ...base, record: { ...rec, reply: 'Yarın değişiyor.', status: 'in_progress' }, old_record: rec });
    expect(replied).toMatchObject({ change: 'reply', authorId: 'u1' });
    expect(feedbackContent(replied as FeedbackEvent).body).toBe('Geri bildirimine yanıt geldi.');
    expect(parseWebhook({ ...base, record: { ...rec, status: 'resolved' }, old_record: rec })).toMatchObject({ change: 'reply' });
    // Yalnızca İnceleniyor / aynı yanıt / yanıt silindi / yazar silinmiş
    expect(parseWebhook({ ...base, record: { ...rec, status: 'in_progress' }, old_record: rec })).toBeNull();
    const withReply = { ...rec, reply: 'Tamam' };
    expect(parseWebhook({ ...base, record: { ...withReply, status: 'in_progress' }, old_record: withReply })).toBeNull();
    expect(parseWebhook({ ...base, record: rec, old_record: withReply })).toBeNull();
    expect(parseWebhook({ ...base, record: { ...rec, author_id: null, status: 'resolved' }, old_record: rec })).toBeNull();
  });

  it('kanal "Geri bildirim"; dokununca yönetici ayrıntı, yazar Gönderdiklerim', () => {
    const e: FeedbackEvent = { kind: 'feedback', change: 'new', feedbackId: 'f1', gymId: GYM, category: 'other', authorId: 'u1' };
    const [m] = buildMessages(['T'], e, feedbackContent(e));
    expect(m.channelId).toBe(CHANNEL_FEEDBACK);
    expect(PUSH_CHANNELS.find((c) => c.id === CHANNEL_FEEDBACK)?.name).toBe('Geri bildirim');
    expect(pushTarget(m.data)).toEqual({ pathname: '/gym/feedback/[id]', params: { id: 'f1', gymId: GYM } });
    const [r] = buildMessages(['T'], { ...e, change: 'reply' }, feedbackContent({ ...e, change: 'reply' }));
    expect(pushTarget(r.data)).toEqual({ pathname: '/feedback/mine', params: { gymId: GYM } });
  });
});

describe('gizlilik', () => {
  it('özet geri bildirim cümlesini içeriyor', () => {
    const text = LEGAL_DOCUMENTS.privacy.blocks.flatMap((b) => (b.kind === 'paragraph' ? [b.text] : b.items)).join('\n');
    expect(text).toContain(
      "Salona geri bildirim gönderirsen metin ve eklediğin fotoğraf salon yönetimine iletilir. 'İsmim gizli kalsın' seçersen yönetim kim yazdığını görmez."
    );
  });
});
