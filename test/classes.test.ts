/**
 * Grup ders programı (v3.2c) — saf mantık: haftanın dersleri (şablon +
 * istisna), "bugün / yarının ilk dersi", hafta ve ay/yıl geçişleri,
 * saat dilimi, formlar, önbellek. Sunucu kuralları:
 * test/integration/classes.int.ts.
 */

import { describe, expect, it } from 'vitest';

import { classifyAccountError } from '@/lib/auth';

import {
  addDays,
  canChangeOccurrence,
  canEditSchedule,
  changeDraftError,
  changeRow,
  changeSummary,
  exceptionAnnouncement,
  formatDayLong,
  formatWeekRange,
  gymNow,
  isPast,
  isTemplateDraftDirty,
  occurrencesForDate,
  occurrencesForWeek,
  parseExceptionRows,
  parseTemplateRows,
  parseTime,
  readScheduleCache,
  sanitizeTimeInput,
  scheduleCacheKey,
  scheduleForGym,
  templateDraftError,
  templateRow,
  templateToDraft,
  todaySummary,
  weekDays,
  weekStartOf,
  weekdayOf,
  writeScheduleCache,
  emptyTemplateDraft,
  type ClassException,
  type ClassSchedule,
  type ClassTemplate,
} from '@/lib/classes';

const GYM = 'gym-1';

const tpl = (over: Partial<ClassTemplate> & Pick<ClassTemplate, 'id' | 'weekday' | 'startTime' | 'name'>): ClassTemplate => ({
  gymId: GYM,
  durationMin: 60,
  instructorName: 'Hoca',
  tagline: null,
  active: true,
  ...over,
});

const ex = (over: Partial<ClassException> & Pick<ClassException, 'templateId' | 'date' | 'kind'>): ClassException => ({
  id: `ex-${over.templateId}-${over.date}`,
  gymId: GYM,
  startTime: null,
  instructorName: null,
  note: null,
  ...over,
});

// Test Salonu'nun programı (spec, Bölüm 3)
const PROGRAM: ClassTemplate[] = [
  tpl({ id: 'pzt-dans', weekday: 1, startTime: '20:00', name: 'Dans', instructorName: 'Tülay Hoca', tagline: 'Ritmini Hisset' }),
  tpl({ id: 'sal-cycle', weekday: 2, startTime: '19:00', name: 'Cycle', instructorName: 'Duygu Hoca' }),
  tpl({ id: 'sal-dans', weekday: 2, startTime: '20:00', name: 'Dans', instructorName: 'Tülay Hoca' }),
  tpl({ id: 'car-pilates', weekday: 3, startTime: '19:15', name: 'Pilates', instructorName: 'Yeliz Hoca' }),
  tpl({ id: 'car-zumba', weekday: 3, startTime: '18:00', name: 'Zumba', instructorName: 'Bilgin Hoca' }),
  tpl({ id: 'per-zumba', weekday: 4, startTime: '18:00', name: 'Zumba', instructorName: 'Bilgin Hoca' }),
  tpl({ id: 'per-cycle', weekday: 4, startTime: '19:00', name: 'Cycle', instructorName: 'Duygu Hoca' }),
  tpl({ id: 'cum-yoga', weekday: 5, startTime: '19:00', name: 'Yoga', instructorName: 'Nihan Hoca' }),
];

const schedule = (exceptions: ClassException[] = [], templates = PROGRAM): ClassSchedule => ({ templates, exceptions });

/** Salonda (UTC+3) verilen yerel an */
const istanbul = (iso: string) => Date.parse(`${iso}+03:00`);

describe('Takvim yardımcıları', () => {
  it('haftanın günü ISO (1 = Pazartesi, 7 = Pazar)', () => {
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2026-10-15')).toBe(4);
    expect(weekdayOf('2026-10-18')).toBe(7);
  });

  it('hafta pazartesi başlar; pazar da önceki pazartesiye bağlı', () => {
    expect(weekStartOf('2026-10-12')).toBe('2026-10-12');
    expect(weekStartOf('2026-10-15')).toBe('2026-10-12');
    expect(weekStartOf('2026-10-18')).toBe('2026-10-12');
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
  });

  it('ay ve yıl sınırını geçen hafta', () => {
    expect(weekDays('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(formatWeekRange('2026-12-28')).toBe('28 Aralık – 3 Ocak');
    expect(formatWeekRange('2026-10-12')).toBe('12–18 Ekim');
    expect(formatWeekRange('2026-09-28')).toBe('28 Eylül – 4 Ekim');
    // Artık yıl: 29 Şubat
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('önceki / sonraki hafta okları 7 gün kaydırır (yaz saati geçişi etkilemez)', () => {
    expect(addDays('2026-10-12', 7)).toBe('2026-10-19');
    expect(addDays('2026-10-12', -7)).toBe('2026-10-05');
    // Avrupa'da saat 25 Ekim'de geri alınıyor; UTC hesabında gün kaymaz
    expect(addDays('2026-10-19', 7)).toBe('2026-10-26');
    expect(addDays('2026-03-23', 7)).toBe('2026-03-30');
  });

  it('gün adı ve tarih: "Perşembe 15 Ekim"', () => {
    expect(formatDayLong('2026-10-15')).toBe('Perşembe 15 Ekim');
    expect(formatDayLong('2027-01-03')).toBe('Pazar 3 Ocak');
  });

  it('saat girişi ve ayrıştırma', () => {
    expect(sanitizeTimeInput('1930')).toBe('19:30');
    expect(sanitizeTimeInput('19:3')).toBe('19:3');
    expect(sanitizeTimeInput('9')).toBe('9');
    expect(sanitizeTimeInput('ab12c345')).toBe('12:34');
    expect(parseTime('19:30')).toBe(19 * 60 + 30);
    expect(parseTime('19:30:00')).toBe(19 * 60 + 30); // sunucu biçimi
    expect(parseTime('9:05')).toBe(9 * 60 + 5);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('19:60')).toBeNull();
    expect(parseTime('19:3')).toBeNull();
  });
});

describe('Saat dilimi: program salonun yerel saatiyle', () => {
  it('"bugün" ve "şimdi" salonun saatine göre, telefonun dilimine göre değil', () => {
    // UTC 21:30 → İstanbul'da ertesi gün 00:30
    expect(gymNow(Date.parse('2026-10-15T21:30:00Z'))).toEqual({ date: '2026-10-16', minutes: 30 });
    // UTC 20:59 → İstanbul 23:59, aynı gün
    expect(gymNow(Date.parse('2026-10-15T20:59:00Z'))).toEqual({ date: '2026-10-15', minutes: 23 * 60 + 59 });
    // Yılbaşı
    expect(gymNow(Date.parse('2026-12-31T21:00:00Z'))).toEqual({ date: '2027-01-01', minutes: 0 });
  });

  it('telefon başka dilimdeyken ders saati ve günü aynı', () => {
    const originalTz = process.env.TZ;
    const at = istanbul('2026-10-15T17:00:00'); // Perşembe 17:00, İstanbul
    const results: unknown[] = [];
    try {
      for (const tz of ['Europe/Istanbul', 'America/New_York', 'Asia/Tokyo', 'UTC']) {
        process.env.TZ = tz;
        const summary = todaySummary(schedule(), at);
        results.push(summary.kind === 'today' ? summary.items.map((o) => [o.date, o.startTime, o.name]) : summary);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
    const expected = [
      ['2026-10-15', '18:00', 'Zumba'],
      ['2026-10-15', '19:00', 'Cycle'],
    ];
    for (const r of results) expect(r).toEqual(expected);
  });
});

describe('Haftanın dersleri: şablon + istisna', () => {
  it('her gün kendi dersleri, saat sırasıyla (şablon sırası önemsiz)', () => {
    const week = occurrencesForWeek(schedule(), '2026-10-12');
    const names = [...week.values()].map((list) => list.map((o) => `${o.startTime} ${o.name}`));
    expect(names).toEqual([
      ['20:00 Dans'],
      ['19:00 Cycle', '20:00 Dans'],
      ['18:00 Zumba', '19:15 Pilates'],
      ['18:00 Zumba', '19:00 Cycle'],
      ['19:00 Yoga'],
      [],
      [],
    ]);
    const [dans] = week.get('2026-10-12')!;
    expect(dans).toMatchObject({
      key: 'pzt-dans:2026-10-12',
      endTime: '21:00',
      instructorName: 'Tülay Hoca',
      tagline: 'Ritmini Hisset',
      status: 'normal',
    });
  });

  it('iptal yalnızca o tarihte; sonraki hafta ders normal', () => {
    const s = schedule([ex({ templateId: 'per-zumba', date: '2026-10-15', kind: 'cancelled' })]);
    expect(occurrencesForDate(s, '2026-10-15')[0]).toMatchObject({ name: 'Zumba', status: 'cancelled' });
    expect(occurrencesForDate(s, '2026-10-22')[0]).toMatchObject({ name: 'Zumba', status: 'normal' });
    // Aynı gündeki diğer ders etkilenmez
    expect(occurrencesForDate(s, '2026-10-15')[1]).toMatchObject({ name: 'Cycle', status: 'normal' });
  });

  it('değişiklik: saat ve hoca o tarih için; sıralama yeni saate göre', () => {
    const s = schedule([
      ex({ templateId: 'per-zumba', date: '2026-10-15', kind: 'changed', startTime: '19:30', instructorName: 'Ayşe Hoca' }),
    ]);
    const list = occurrencesForDate(s, '2026-10-15');
    expect(list.map((o) => `${o.startTime} ${o.name}`)).toEqual(['19:00 Cycle', '19:30 Zumba']);
    const zumba = list[1];
    expect(zumba).toMatchObject({
      status: 'changed',
      startTime: '19:30',
      endTime: '20:30',
      originalStartTime: '18:00',
      instructorName: 'Ayşe Hoca',
      originalInstructorName: 'Bilgin Hoca',
    });
    expect(changeSummary(zumba)).toBe('Saat değişti: 19:30 · Hoca: Ayşe Hoca');
  });

  it('yalnızca not içeren değişiklik', () => {
    const s = schedule([ex({ templateId: 'cum-yoga', date: '2026-10-16', kind: 'changed', note: 'Büyük salonda' })]);
    const [yoga] = occurrencesForDate(s, '2026-10-16');
    expect(yoga).toMatchObject({ status: 'changed', startTime: '19:00', instructorName: 'Nihan Hoca' });
    expect(changeSummary(yoga)).toBe('Büyük salonda');
  });

  it('pasif şablon hiçbir günde görünmez (istisnası olsa bile)', () => {
    const templates = PROGRAM.map((t) => (t.id === 'cum-yoga' ? { ...t, active: false } : t));
    const s = schedule([ex({ templateId: 'cum-yoga', date: '2026-10-16', kind: 'changed', note: 'x' })], templates);
    expect(occurrencesForDate(s, '2026-10-16')).toEqual([]);
  });

  it('başka salonun programı karışmaz', () => {
    const other = tpl({ id: 'b-yoga', gymId: 'gym-2', weekday: 5, startTime: '08:00', name: 'B Yoga' });
    const all = schedule([], [...PROGRAM, other]);
    expect(occurrencesForDate(scheduleForGym(all, GYM), '2026-10-16').map((o) => o.name)).toEqual(['Yoga']);
    expect(occurrencesForDate(scheduleForGym(all, 'gym-2'), '2026-10-16').map((o) => o.name)).toEqual(['B Yoga']);
  });

  it('gece yarısını geçen ders: bitiş saati sarar, ders geçmiş sayılmaz', () => {
    const late = tpl({ id: 'gece', weekday: 4, startTime: '23:30', name: 'Gece', durationMin: 60 });
    const [o] = occurrencesForDate(schedule([], [late]), '2026-10-15');
    expect(o.endTime).toBe('00:30');
    expect(isPast(o, istanbul('2026-10-15T23:45:00'))).toBe(false);
  });
});

describe('Geçmiş dersler', () => {
  const [zumba] = occurrencesForDate(schedule(), '2026-10-15'); // 18:00–19:00

  it('bitince geçmiş; devam ederken değil', () => {
    expect(isPast(zumba, istanbul('2026-10-15T17:59:00'))).toBe(false);
    expect(isPast(zumba, istanbul('2026-10-15T18:30:00'))).toBe(false);
    expect(isPast(zumba, istanbul('2026-10-15T19:00:00'))).toBe(true);
    expect(isPast(zumba, istanbul('2026-10-16T08:00:00'))).toBe(true);
    expect(isPast(zumba, istanbul('2026-10-14T23:00:00'))).toBe(false);
  });

  it('istisna yalnızca bugün ve sonrası için', () => {
    expect(canChangeOccurrence(zumba, istanbul('2026-10-15T20:00:00'))).toBe(true);
    expect(canChangeOccurrence(zumba, istanbul('2026-10-16T00:10:00'))).toBe(false);
  });
});

describe('Ana sayfa: bugün / yarının ilk dersi', () => {
  it('bugünün dersleri saat sırasıyla, iptal edilen dahil', () => {
    const s = schedule([ex({ templateId: 'per-zumba', date: '2026-10-15', kind: 'cancelled' })]);
    const r = todaySummary(s, istanbul('2026-10-15T09:00:00'));
    expect(r.kind).toBe('today');
    if (r.kind !== 'today') return;
    expect(r.items.map((o) => [o.startTime, o.name, o.status])).toEqual([
      ['18:00', 'Zumba', 'cancelled'],
      ['19:00', 'Cycle', 'normal'],
    ]);
  });

  it('bugün ders yoksa yarının ilk dersi', () => {
    // Pazar → yarın Pazartesi 20:00 Dans
    expect(todaySummary(schedule(), istanbul('2026-10-18T10:00:00'))).toMatchObject({
      kind: 'tomorrow',
      date: '2026-10-19',
      first: { startTime: '20:00', name: 'Dans' },
    });
  });

  it('yarının ilk dersi iptalse sonraki; hepsi iptalse "yok"', () => {
    // Pazartesi dersi olmayan program: bugün (Pzt) yok, yarın (Salı) 19:00 Cycle iptal → 20:00 Dans
    const noMonday = PROGRAM.filter((t) => t.id !== 'pzt-dans');
    const s = schedule([ex({ templateId: 'sal-cycle', date: '2026-10-13', kind: 'cancelled' })], noMonday);
    expect(todaySummary(s, istanbul('2026-10-12T10:00:00'))).toMatchObject({
      kind: 'tomorrow',
      date: '2026-10-13',
      first: { startTime: '20:00', name: 'Dans' },
    });
    // Pazar: yarının tek dersi iptal → "yok"
    const allCancelled = schedule([ex({ templateId: 'pzt-dans', date: '2026-10-19', kind: 'cancelled' })]);
    expect(todaySummary(allCancelled, istanbul('2026-10-18T10:00:00'))).toEqual({ kind: 'none' });
  });

  it('cumartesi: bugün de yarın da ders yok', () => {
    expect(todaySummary(schedule(), istanbul('2026-10-17T10:00:00'))).toEqual({ kind: 'none' });
  });

  it('gece yarısından sonra "bugün" yeni gün (salon saatiyle)', () => {
    // Perşembe 23:59 → bugün Perşembe; Cuma 00:01 → bugün Cuma
    expect(todaySummary(schedule(), istanbul('2026-10-15T23:59:00'))).toMatchObject({ kind: 'today', date: '2026-10-15' });
    expect(todaySummary(schedule(), istanbul('2026-10-16T00:01:00'))).toMatchObject({ kind: 'today', date: '2026-10-16' });
  });

  it('yıl sonu: 31 Aralık Perşembe dersleri, ertesi gün yeni yıl', () => {
    expect(todaySummary(schedule(), istanbul('2026-12-31T08:00:00'))).toMatchObject({
      kind: 'today',
      date: '2026-12-31',
    });
    expect(todaySummary(schedule(), istanbul('2027-01-01T08:00:00'))).toMatchObject({
      kind: 'today',
      date: '2027-01-01',
      items: [{ name: 'Yoga' }],
    });
  });
});

describe('Duyuru önerisi', () => {
  it('iptal: "Perşembe 15 Ekim 18:00 Zumba dersi iptal edildi."', () => {
    const s = schedule([ex({ templateId: 'per-zumba', date: '2026-10-15', kind: 'cancelled' })]);
    expect(exceptionAnnouncement(occurrencesForDate(s, '2026-10-15')[0])).toEqual({
      title: 'Zumba dersi iptal',
      body: 'Perşembe 15 Ekim 18:00 Zumba dersi iptal edildi.',
    });
  });

  it('değişiklik: yeni saat, hoca ve not', () => {
    const s = schedule([
      ex({
        templateId: 'per-zumba',
        date: '2026-10-15',
        kind: 'changed',
        startTime: '19:30',
        instructorName: 'Ayşe Hoca',
        note: 'Büyük salonda.',
      }),
    ]);
    const o = occurrencesForDate(s, '2026-10-15').find((x) => x.name === 'Zumba')!;
    expect(exceptionAnnouncement(o)).toEqual({
      title: 'Zumba dersinde değişiklik',
      body: 'Perşembe 15 Ekim 18:00 Zumba dersinde değişiklik var. Yeni saat: 19:30. Dersi Ayşe Hoca verecek. Büyük salonda.',
    });
  });

  it('normal derste öneri yok; başlık duyuru sınırının (80) altında', () => {
    const [o] = occurrencesForDate(schedule(), '2026-10-15');
    expect(exceptionAnnouncement(o)).toBeNull();
    const long = tpl({ id: 'uzun', weekday: 4, startTime: '10:00', name: 'x'.repeat(40) });
    const s = schedule([ex({ templateId: 'uzun', date: '2026-10-15', kind: 'changed', note: 'n' })], [long]);
    expect([...exceptionAnnouncement(occurrencesForDate(s, '2026-10-15')[0])!.title].length).toBeLessThanOrEqual(80);
  });
});

describe('Formlar', () => {
  const valid = { ...emptyTemplateDraft(4), startTime: '18:00', name: 'Zumba', instructorName: 'Bilgin Hoca' };

  it('ders formu doğrulaması', () => {
    expect(templateDraftError(valid)).toBeNull();
    expect(templateDraftError({ ...valid, startTime: '18' })).toMatch(/SS:DD/);
    expect(templateDraftError({ ...valid, durationMin: '4' })).toMatch(/Süre/);
    expect(templateDraftError({ ...valid, durationMin: '481' })).toMatch(/Süre/);
    expect(templateDraftError({ ...valid, name: '  ' })).toMatch(/Ders adı boş/);
    expect(templateDraftError({ ...valid, name: 'x'.repeat(41) })).toMatch(/40/);
    expect(templateDraftError({ ...valid, name: '💪'.repeat(40) })).toBeNull(); // emoji tek karakter
    expect(templateDraftError({ ...valid, instructorName: '' })).toMatch(/Hoca adı boş/);
    expect(templateDraftError({ ...valid, tagline: 'x'.repeat(61) })).toMatch(/60/);
  });

  it('sunucuya giden satır: kırpılmış, boş slogan null, saat SS:DD', () => {
    expect(templateRow({ ...valid, startTime: '9:05', name: ' Zumba ', tagline: '  ' })).toEqual({
      weekday: 4,
      start_time: '09:05',
      duration_min: 60,
      name: 'Zumba',
      instructor_name: 'Bilgin Hoca',
      tagline: null,
      active: true,
    });
  });

  it('kaydedilmemiş değişiklik', () => {
    const original = templateToDraft(PROGRAM[5]);
    expect(isTemplateDraftDirty(original, original)).toBe(false);
    expect(isTemplateDraftDirty({ ...original, name: 'Zumba ' }, original)).toBe(false);
    expect(isTemplateDraftDirty({ ...original, startTime: '18:00:00' }, original)).toBe(false);
    expect(isTemplateDraftDirty({ ...original, weekday: 5 }, original)).toBe(true);
    expect(isTemplateDraftDirty({ ...original, active: false }, original)).toBe(true);
  });

  it('"Bu ders için değiştir": şablondakiyle aynı alan değişiklik sayılmaz', () => {
    const [zumba] = occurrencesForDate(schedule(), '2026-10-15');
    const same = { startTime: '18:00', instructorName: 'Bilgin Hoca', note: '' };
    expect(changeDraftError(same, zumba)).toMatch(/Değişiklik yok/);
    expect(changeRow({ ...same, startTime: '1930'.replace(/(\d\d)(\d\d)/, '$1:$2') }, zumba)).toEqual({
      kind: 'changed',
      start_time: '19:30',
      instructor_name: null,
      note: null,
    });
    expect(changeDraftError({ ...same, note: 'Büyük salonda' }, zumba)).toBeNull();
    expect(changeDraftError({ ...same, note: 'x'.repeat(121) }, zumba)).toMatch(/120/);
    expect(changeDraftError({ ...same, instructorName: ' ' }, zumba)).toMatch(/Hoca adı boş/);
  });

  it('programı yalnızca yönetici düzenler (görünüm)', () => {
    const memberships = [
      { gymId: GYM, role: 'admin' as const },
      { gymId: 'gym-2', role: 'trainer' as const },
      { gymId: 'gym-3', role: 'member' as const },
    ];
    expect(canEditSchedule(GYM, memberships)).toBe(true);
    expect(canEditSchedule('gym-2', memberships)).toBe(false);
    expect(canEditSchedule('gym-3', memberships)).toBe(false);
    expect(canEditSchedule(null, memberships)).toBe(false);
  });
});

describe('Sunucu satırları ve önbellek', () => {
  it('sunucu hataları: tekil istisna, gün uyuşmazlığı, yetki', () => {
    expect(classifyAccountError({ code: '23505', message: 'duplicate key value' })).toBe('already_exists');
    expect(classifyAccountError({ code: '23514', message: 'class_date_weekday_mismatch' })).toBe('invalid_input');
    expect(classifyAccountError({ code: '42501', message: 'permission denied for class_exceptions' })).toBe('forbidden');
  });

  it('satırlar ayrıştırılır, saat "SS:DD:ss" → "SS:DD", bozuklar atlanır', () => {
    expect(
      parseTemplateRows([
        {
          id: 't1',
          gym_id: GYM,
          weekday: 3,
          start_time: '19:15:00',
          duration_min: 45,
          name: 'Pilates',
          instructor_name: 'Yeliz Hoca',
          tagline: '',
          active: true,
        },
        { id: 't2', gym_id: GYM, weekday: 8, start_time: '10:00', name: 'x', instructor_name: 'y' },
        { id: 't3', gym_id: GYM, weekday: 1, start_time: 'saat', name: 'x', instructor_name: 'y' },
        null,
      ])
    ).toEqual([
      {
        id: 't1',
        gymId: GYM,
        weekday: 3,
        startTime: '19:15',
        durationMin: 45,
        name: 'Pilates',
        instructorName: 'Yeliz Hoca',
        tagline: null,
        active: true,
      },
    ]);
    expect(
      parseExceptionRows([
        { id: 'e1', template_id: 't1', gym_id: GYM, date: '2026-10-14', kind: 'changed', start_time: '20:00:00' },
        { id: 'e2', template_id: 't1', gym_id: GYM, date: '2026-10-14', kind: 'moved' },
      ])
    ).toEqual([
      {
        id: 'e1',
        templateId: 't1',
        gymId: GYM,
        date: '2026-10-14',
        kind: 'changed',
        startTime: '20:00',
        instructorName: null,
        note: null,
      },
    ]);
  });

  it('önbellek kullanıcıya göre; bozuksa yok sayılır', async () => {
    const data = new Map<string, string>();
    const store = {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
    };
    const s = schedule([ex({ templateId: 'per-zumba', date: '2026-10-15', kind: 'cancelled' })]);
    await writeScheduleCache(store, 'u1', { fetchedAt: '2026-10-15T09:00:00Z', ...s });
    expect(await readScheduleCache(store, 'u1')).toEqual({ fetchedAt: '2026-10-15T09:00:00Z', ...s });
    expect(await readScheduleCache(store, 'u2')).toBeNull();
    data.set(scheduleCacheKey('u3'), '{bozuk');
    expect(await readScheduleCache(store, 'u3')).toBeNull();
  });
});
