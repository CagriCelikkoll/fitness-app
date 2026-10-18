/**
 * Salon girişi ve devam (v3.6c): QR içeriği ve çizimi, süre (açık,
 * kapalı, 4 saat aşımı), aylık gün ve ortalama (UTC+3, ay sınırı), seri,
 * ısı haritası, hoca listesi sıralaması, yönetici sayıları, antrenman–
 * ziyaret bağlama, elle giriş saati, gizlilik metni.
 */

import { describe, expect, it } from 'vitest';

import { LEGAL_DOCUMENTS } from '@/content/legal';
import { classifyAccountError } from '@/lib/auth';
import { qrMatrix, qrPath } from '@/lib/qr';
import {
  attendanceText,
  buildCheckinQr,
  checkinParams,
  currentVisit,
  dailyCounts,
  daysSinceLastVisit,
  formatMinutes,
  gymLocalToIso,
  gymTime,
  heatmap,
  insideNow,
  insideText,
  isInactive,
  lastVisitText,
  monthStats,
  occupancyText,
  parseCheckinQr,
  parseVisitRows,
  qrProblem,
  qrProblemText,
  readOpenVisit,
  shouldLinkWorkout,
  sortByAttendance,
  studentAttendance,
  visitDayKey,
  visitRowText,
  visitState,
  visitsSince,
  weekStart,
  writeOpenVisit,
  type Visit,
} from '@/lib/visits';

const GYM = '0b6f9f6e-1111-4222-8333-444455556666';
const SECRET = 'AbCdEfGhIjKlMnOpQrSt_-';
/** Salonda (UTC+3) verilen yerel an */
const ist = (local: string) => Date.parse(`${local}+03:00`);
const iso = (local: string) => new Date(ist(local)).toISOString();

let seq = 0;
const visit = (inLocal: string, outLocal: string | null = null, over: Partial<Visit> = {}): Visit => ({
  id: `v${++seq}`,
  gymId: GYM,
  userId: 'u1',
  checkedInAt: iso(inLocal),
  checkedOutAt: outLocal ? iso(outLocal) : null,
  source: 'qr',
  workoutClientId: null,
  ...over,
});

describe('QR', () => {
  it('içerik: dinc://checkin?g=…&k=… ve geri ayrıştırma', () => {
    const data = buildCheckinQr(GYM, SECRET);
    expect(data).toBe(`dinc://checkin?g=${GYM}&k=${SECRET}`);
    expect(parseCheckinQr(data)).toEqual({ gymId: GYM, secret: SECRET });
    // Sistem bağlantısı biçimi ve büyük harfli kimlik
    expect(parseCheckinQr(`dinc:///checkin?k=${SECRET}&g=${GYM.toUpperCase()}`)).toEqual({ gymId: GYM, secret: SECRET });
  });

  it('bizim afişimiz değilse null', () => {
    for (const bad of [
      'https://example.com',
      `dinc://checkin?g=${GYM}`,
      `dinc://checkin?g=salon&k=${SECRET}`,
      `dinc://checkin?g=${GYM}&k=kisa`,
      `dinc://baska?g=${GYM}&k=${SECRET}`,
      `dinc://checkin?g=${GYM}&k=${SECRET}<script>`,
      '',
      null,
    ]) {
      expect(parseCheckinQr(bad as string), String(bad)).toBeNull();
    }
    expect(checkinParams(GYM, SECRET)).toEqual({ gymId: GYM, secret: SECRET });
    expect(checkinParams(undefined, SECRET)).toBeNull();
  });

  it('başka salonun QR\'ı / Dinç QR\'ı değil', () => {
    const parsed = parseCheckinQr(buildCheckinQr(GYM, SECRET));
    expect(qrProblem(parsed, [GYM])).toBeNull();
    expect(qrProblem(parsed, ['baska-salon'])).toBe('other_gym');
    expect(qrProblem(null, [GYM])).toBe('not_ours');
    expect(qrProblemText('other_gym')).toBe('Bu QR başka bir salona ait.');
    expect(classifyAccountError({ message: 'checkin_key_invalid' })).toBe('checkin_key_invalid');
  });

  it('matris: konum desenleri köşelerde, yol kenar boşluklu', () => {
    const m = qrMatrix(buildCheckinQr(GYM, SECRET));
    expect(m.size).toBeGreaterThanOrEqual(21);
    expect((m.size - 17) % 4).toBe(0);
    // Sol üst konum deseni: 7 koyu, ortada açık halka
    for (let i = 0; i < 7; i++) {
      expect(m.dark(i, 0)).toBe(true);
      expect(m.dark(0, i)).toBe(true);
      expect(m.dark(m.size - 1 - i, 0)).toBe(true);
      expect(m.dark(0, m.size - 1 - i)).toBe(true);
    }
    expect(m.dark(1, 1)).toBe(false);
    expect(m.dark(3, 3)).toBe(true);
    const path = qrPath(m, 4);
    expect(path.startsWith('M4 4h7v1h-7z')).toBe(true);
  });
});

describe('süre ve durum', () => {
  const now = ist('2026-10-19T19:00:00');

  it('kapalı: dakika; açık 3 saatten yeni: salonda; 3–4 saat: belirsiz; 4 saatten eski: bilinmiyor', () => {
    expect(visitState(visit('2026-10-19T17:00:00', '2026-10-19T18:12:00'), now)).toEqual({ kind: 'closed', minutes: 72 });
    expect(visitState(visit('2026-10-19T18:18:00'), now)).toEqual({ kind: 'inside', minutes: 42 });
    expect(visitState(visit('2026-10-19T15:30:00'), now)).toEqual({ kind: 'pending' });
    expect(visitState(visit('2026-10-19T14:59:00'), now)).toEqual({ kind: 'unknown' });
  });

  it('şu anki ziyaret yalnızca benim, bu salonda, salondaysam', () => {
    const mine = visit('2026-10-19T18:00:00');
    const list = [visit('2026-10-19T14:00:00'), mine, visit('2026-10-19T18:30:00', null, { userId: 'u2' })];
    expect(currentVisit(list, 'u1', GYM, now)?.id).toBe(mine.id);
    expect(currentVisit(list, 'u1', 'baska', now)).toBeNull();
    expect(currentVisit([visit('2026-10-19T18:00:00', '2026-10-19T18:50:00')], 'u1', GYM, now)).toBeNull();
  });

  it('metinler', () => {
    expect(formatMinutes(42)).toBe('42 dk');
    expect(formatMinutes(60)).toBe('1 sa');
    expect(formatMinutes(72)).toBe('1 sa 12 dk');
    expect(insideText(42)).toBe('Salondasın · 42 dk');
    expect(occupancyText(12)).toBe('Şu an salonda ~12 kişi');
    expect(occupancyText(0)).toBe('Şu an salonda kimse yok');
    expect(occupancyText(null)).toBeNull();
  });
});

describe('ay, ortalama, seri (UTC+3)', () => {
  it('ay sınırı salon saatiyle: 31 Ekim 23:30 Ekim, 1 Kasım 00:30 Kasım', () => {
    // UTC'de ikisi de 31 Ekim
    expect(visitDayKey(iso('2026-10-31T23:30:00'))).toBe('2026-10-31');
    expect(visitDayKey(iso('2026-11-01T00:30:00'))).toBe('2026-11-01');
    const visits = [visit('2026-10-31T23:30:00', '2026-11-01T00:30:00'), visit('2026-11-01T00:30:00', '2026-11-01T01:00:00')];
    expect(monthStats(visits, ist('2026-11-01T12:00:00')).days).toBe(1);
    expect(monthStats(visits, ist('2026-10-31T23:50:00')).days).toBe(1);
  });

  it('gün sayısı tekil gün; ortalama yalnızca süresi belli ziyaretler', () => {
    const now = ist('2026-10-19T20:00:00');
    const visits = [
      visit('2026-10-02T18:00:00', '2026-10-02T19:00:00'), // 60
      visit('2026-10-02T21:00:00', '2026-10-02T21:30:00'), // aynı gün, 30
      visit('2026-10-05T18:00:00'), // açık kalmış, bilinmiyor: güne girer, ortalamaya girmez
      visit('2026-10-19T19:30:00'), // şu an içeride: ortalamaya girmez
      visit('2026-09-30T18:00:00', '2026-09-30T20:00:00'), // geçen ay
    ];
    const s = monthStats(visits, now);
    expect(s.days).toBe(3);
    expect(s.averageMinutes).toBe(45);
    expect(monthStats([visit('2026-10-05T18:00:00')], now).averageMinutes).toBeNull();
  });

  it('bu hafta ve seri (pazartesiden başlayan haftalar)', () => {
    expect(weekStart('2026-10-19')).toBe('2026-10-19'); // Pazartesi
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // Pazar
    const now = ist('2026-10-21T12:00:00'); // Çarşamba
    const visits = [
      visit('2026-10-19T18:00:00', '2026-10-19T19:00:00'),
      visit('2026-10-20T18:00:00', '2026-10-20T19:00:00'),
      visit('2026-10-14T18:00:00', '2026-10-14T19:00:00'),
      visit('2026-10-06T18:00:00', '2026-10-06T19:00:00'),
      visit('2026-09-22T18:00:00', '2026-09-22T19:00:00'), // boşluktan sonra
    ];
    const s = monthStats(visits, now);
    expect(s.weekDays).toBe(2);
    expect(s.streakWeeks).toBe(3);
    // Bu hafta henüz gelinmediyse seri geçen haftadan sayılır
    expect(monthStats(visits.slice(2), now).streakWeeks).toBe(2);
    expect(monthStats([], now)).toEqual({ days: 0, averageMinutes: null, weekDays: 0, streakWeeks: 0 });
  });

  it('ısı haritası: 8 hafta × 7 gün, pazartesiden, gelecek günler işaretli', () => {
    const now = ist('2026-10-21T12:00:00');
    const h = heatmap([visit('2026-10-20T18:00:00'), visit('2026-10-20T21:00:00'), visit('2026-08-31T10:00:00')], now);
    expect(h).toHaveLength(8);
    expect(h.every((w) => w.length === 7)).toBe(true);
    expect(h[0][0].date).toBe('2026-08-31');
    expect(h[0][0].count).toBe(1);
    expect(h[7][1]).toEqual({ date: '2026-10-20', count: 2, future: false });
    expect(h[7][2].future).toBe(false);
    expect(h[7][3].future).toBe(true);
  });

  it('veri çekme başlangıcı ısı haritasını ve ayın başını kapsar', () => {
    const now = ist('2026-10-21T12:00:00');
    expect(visitsSince(now)).toBe(new Date(ist('2026-08-31T00:00:00')).toISOString());
    // Ayın başı 8 haftadan eskiyse (ör. 31'inde değil, ama ay uzun) ay başı
    expect(visitsSince(ist('2026-10-31T12:00:00'), 1)).toBe(new Date(ist('2026-10-01T00:00:00')).toISOString());
  });
});

describe('hoca listesi', () => {
  const now = ist('2026-10-21T12:00:00');

  it('son geliş metni ve 10 gün uyarısı', () => {
    expect(daysSinceLastVisit([], now)).toBeNull();
    expect(daysSinceLastVisit([visit('2026-10-19T23:30:00'), visit('2026-10-01T10:00:00')], now)).toBe(2);
    expect(lastVisitText(0)).toBe('Bugün geldi');
    expect(lastVisitText(1)).toBe('Dün geldi');
    expect(lastVisitText(2)).toBe('2 gün önce geldi');
    expect(lastVisitText(null)).toBe('Henüz gelmedi');
    expect(isInactive(10)).toBe(false);
    expect(isInactive(11)).toBe(true);
    expect(isInactive(null)).toBe(true);
  });

  it('satır metni ve sıralama: gelmeyenler üstte (en uzun önce), sonra ada göre', () => {
    const a = studentAttendance([visit('2026-10-19T18:00:00', '2026-10-19T19:05:00')], now);
    expect(attendanceText(a)).toBe('2 gün önce geldi · bu ay 1 gün · ort. 1 sa 5 dk');
    const students = [
      { name: 'Zeynep', a },
      { name: 'Ali', a: studentAttendance([visit('2026-10-20T18:00:00')], now) },
      { name: 'Can', a: studentAttendance([visit('2026-10-05T18:00:00')], now) },
      { name: 'Ece', a: studentAttendance([], now) },
      { name: 'Banu', a: studentAttendance([visit('2026-10-08T18:00:00')], now) },
    ];
    expect(sortByAttendance(students, (s) => s.a, (s) => s.name).map((s) => s.name)).toEqual([
      'Ece',
      'Can',
      'Banu',
      'Ali',
      'Zeynep',
    ]);
  });

  it('ziyaret listesi satırı', () => {
    const row = visitRowText(visit('2026-10-17T18:05:00', '2026-10-17T19:17:00'), now);
    expect(row).toEqual({ date: '17 Ekim Cmt', time: '18:05', duration: '1 sa 12 dk' });
    expect(visitRowText(visit('2026-10-10T18:05:00'), now).duration).toBe('Süre bilinmiyor');
    expect(gymTime(iso('2026-10-17T07:09:00'))).toBe('07:09');
  });
});

describe('yönetici paneli', () => {
  const now = ist('2026-10-21T19:00:00');

  it('şu an salonda: kişi başına bir, önce gelen önce', () => {
    const list = [
      visit('2026-10-21T18:30:00', null, { userId: 'b' }),
      visit('2026-10-21T17:00:00', null, { userId: 'a' }),
      visit('2026-10-21T17:30:00', null, { userId: 'a' }),
      visit('2026-10-21T18:00:00', '2026-10-21T18:40:00', { userId: 'c' }),
      visit('2026-10-21T14:00:00', null, { userId: 'd' }),
    ];
    expect(insideNow(list, now).map((v) => [v.userId, gymTime(v.checkedInAt)])).toEqual([
      ['a', '17:30'],
      ['b', '18:30'],
    ]);
  });

  it('son 7 gün: gün başına kişi (aynı kişi iki kez = 1)', () => {
    const list = [
      visit('2026-10-21T08:00:00', null, { userId: 'a' }),
      visit('2026-10-21T18:00:00', null, { userId: 'a' }),
      visit('2026-10-21T18:00:00', null, { userId: 'b' }),
      visit('2026-10-15T00:10:00', null, { userId: 'a' }),
      visit('2026-10-14T23:50:00', null, { userId: 'a' }), // 8 gün önce
    ];
    const days = dailyCounts(list, now, 7);
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(days.map((d) => d.count)).toEqual([1, 0, 0, 0, 0, 0, 2]);
  });

  it('elle giriş saati salon saatiyle', () => {
    expect(gymLocalToIso('2026-10-21', '18:30')).toBe(iso('2026-10-21T18:30:00'));
    expect(gymLocalToIso('2026-10-21', '7:05')).toBe(iso('2026-10-21T07:05:00'));
    expect(gymLocalToIso('2026-10-21', '24:00')).toBeNull();
    expect(gymLocalToIso('2026-02-30', '10:00')).toBeNull();
    expect(gymLocalToIso('2026-10-21', '1830')).toBeNull();
  });
});

describe('antrenman–ziyaret bağlama', () => {
  const v = { checkedInAt: iso('2026-10-21T18:00:00'), checkedOutAt: null };
  const now = ist('2026-10-21T19:30:00');

  it('antrenman açık ziyaretin içinde bittiyse bağlanır', () => {
    expect(shouldLinkWorkout(v, ist('2026-10-21T19:25:00'), now)).toBe(true);
  });

  it('girişten önce, 4 saatten sonra, gelecekte bitti ya da ziyaret kapalı: bağlanmaz', () => {
    expect(shouldLinkWorkout(v, ist('2026-10-21T17:59:00'), now)).toBe(false);
    expect(shouldLinkWorkout(v, ist('2026-10-21T22:01:00'), ist('2026-10-21T23:00:00'))).toBe(false);
    expect(shouldLinkWorkout(v, ist('2026-10-21T19:40:00'), now)).toBe(false);
    expect(shouldLinkWorkout({ ...v, checkedOutAt: iso('2026-10-21T19:00:00') }, ist('2026-10-21T19:25:00'), now)).toBe(false);
  });

  it('cihazdaki açık ziyaret kaydı yazılır, okunur, silinir; bozuk kayıt null', async () => {
    const data = new Map<string, string>();
    const store = { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, val: string) => void data.set(k, val) };
    const record = { visitId: 'v1', gymId: GYM, checkedInAt: v.checkedInAt };
    await writeOpenVisit(store, 'u1', record);
    expect(await readOpenVisit(store, 'u1')).toEqual(record);
    expect(await readOpenVisit(store, 'u2')).toBeNull();
    await writeOpenVisit(store, 'u1', null);
    expect(await readOpenVisit(store, 'u1')).toBeNull();
    data.set('visits.open.u3', '{bozuk');
    expect(await readOpenVisit(store, 'u3')).toBeNull();
  });
});

describe('satırlar ve gizlilik', () => {
  it('bozuk satır atlanır, bilinmeyen kaynak qr', () => {
    const rows = parseVisitRows([
      { id: 'a', gym_id: GYM, user_id: 'u', checked_in_at: '2026-10-21T15:00:00Z', source: 'turnstile' },
      { id: 'b', gym_id: GYM, user_id: 'u', checked_in_at: 'dün' },
      { id: 'c', gym_id: GYM, user_id: 'u', checked_in_at: '2026-10-21T15:00:00Z', source: 'uzay' },
    ]);
    expect(rows.map((r) => [r.id, r.source])).toEqual([
      ['a', 'turnstile'],
      ['c', 'qr'],
    ]);
  });

  it('gizlilik özeti kamera ve salon girişlerini söylüyor, "kamera erişmez" kalmadı', () => {
    const text = LEGAL_DOCUMENTS.privacy.blocks
      .flatMap((b) => (b.kind === 'paragraph' ? [b.text] : b.items))
      .join('\n');
    expect(text).toContain(
      'Salon girişinde QR okutursan giriş ve çıkış saatlerin kaydedilir; salon yöneticisi ve izin verdiğin hocan görebilir.'
    );
    expect(text).toContain('görüntü kaydedilmez');
    expect(text).not.toMatch(/konum, kamera/);
  });
});
