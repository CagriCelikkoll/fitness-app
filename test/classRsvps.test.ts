/**
 * Derse katılım ve hatırlatma (v3.2c BÖLÜM 5) — saf mantık: kapasite
 * görünümü, katıl / vazgeç yerel durumu, hatırlatma zamanı (salon saat
 * dilimi), vazgeç / iptalde bildirimin kaldırılması, bildirim metni.
 * Sunucu kuralları: test/integration/classRsvps.int.ts.
 */

import { describe, expect, it } from 'vitest';

import { classifyAccountError } from '@/lib/auth';
import { occurrencesForDate, type ClassException, type ClassSchedule, type ClassTemplate } from '@/lib/classes';
import {
  EMPTY_ATTENDANCE,
  FULL_MESSAGE,
  applyRsvp,
  attendanceView,
  attendeeNames,
  buildAttendance,
  canSeeAttendees,
  hasStarted,
  parseCountRows,
  readAttendanceCache,
  writeAttendanceCache,
  type Attendance,
} from '@/lib/classRsvps';
import {
  CLASS_REMINDER_PREFIX,
  atTime,
  classStartMs,
  createClassReminderSync,
  diffReminders,
  myOccurrences,
  planReminders,
  reminderContent,
  reminderFireAtMs,
  reminderTarget,
  type ClassReminder,
} from '@/lib/classReminders';

const GYM = 'gym-1';
const tpl = (over: Partial<ClassTemplate> & Pick<ClassTemplate, 'id' | 'weekday' | 'startTime' | 'name'>): ClassTemplate => ({
  gymId: GYM,
  durationMin: 60,
  instructorName: 'Hoca',
  tagline: null,
  active: true,
  capacity: null,
  ...over,
});

const ZUMBA = tpl({ id: 'per-zumba', weekday: 4, startTime: '18:00', name: 'Zumba', capacity: 20 });
const CYCLE = tpl({ id: 'per-cycle', weekday: 4, startTime: '19:00', name: 'Cycle' });
const schedule = (exceptions: ClassException[] = []): ClassSchedule => ({ templates: [ZUMBA, CYCLE], exceptions });
const THU = '2026-10-15';
const istanbul = (iso: string) => Date.parse(`${iso}+03:00`);
const occ = (s: ClassSchedule, name: string, date = THU) => occurrencesForDate(s, date).find((o) => o.name === name)!;

const attendance = (over: Partial<Attendance> = {}): Attendance => ({ ...EMPTY_ATTENDANCE, ...over });

describe('Katılım görünümü', () => {
  const zumba = occ(schedule(), 'Zumba');
  const cycle = occ(schedule(), 'Cycle');
  const morning = istanbul(`${THU}T09:00:00`);

  it('kapasite yoksa "N kişi katılıyor", kimse yoksa "Henüz katılan yok"', () => {
    expect(attendanceView(cycle, attendance({ counts: { [cycle.key]: 8 } }), morning).countText).toBe('8 kişi katılıyor');
    expect(attendanceView(cycle, attendance(), morning).countText).toBe('Henüz katılan yok');
  });

  it('kapasite varsa "8 / 20"', () => {
    expect(attendanceView(zumba, attendance({ counts: { [zumba.key]: 8 } }), morning)).toMatchObject({
      countText: '8 / 20',
      full: false,
      showButton: true,
      joined: false,
    });
  });

  it('dolunca düğme pasif ve "yine de gelebilirsin" notu; katılmışsa vazgeçebilir', () => {
    const full = attendance({ counts: { [zumba.key]: 20 } });
    expect(attendanceView(zumba, full, morning)).toMatchObject({ full: true, fullMessage: FULL_MESSAGE, countText: '20 / 20' });
    expect(FULL_MESSAGE).toBe('Ders dolu görünüyor. Yine de gelebilirsin; yer durumunu hocana sor.');
    // Kapasite aşılmış (yumuşak sınır)
    expect(attendanceView(zumba, attendance({ counts: { [zumba.key]: 23 } }), morning).countText).toBe('23 / 20');
    const joined = attendance({ counts: { [zumba.key]: 20 }, mine: [zumba.key] });
    expect(attendanceView(zumba, joined, morning)).toMatchObject({ joined: true, full: false, fullMessage: null });
  });

  it('başlamış ve iptal edilmiş derste düğme yok', () => {
    expect(attendanceView(zumba, attendance(), istanbul(`${THU}T18:00:00`)).showButton).toBe(false);
    expect(attendanceView(zumba, attendance(), istanbul(`${THU}T17:59:00`)).showButton).toBe(true);
    const cancelled = occ(schedule([{ id: 'e', templateId: ZUMBA.id, gymId: GYM, date: THU, kind: 'cancelled', startTime: null, instructorName: null, note: null }]), 'Zumba');
    expect(attendanceView(cancelled, attendance({ counts: { [zumba.key]: 20 } }), morning)).toMatchObject({
      showButton: false,
      full: false,
    });
  });

  it('başladı mı: değişen saate göre, salon saatiyle', () => {
    const moved = occ(
      schedule([{ id: 'e', templateId: ZUMBA.id, gymId: GYM, date: THU, kind: 'changed', startTime: '19:30', instructorName: null, note: null }]),
      'Zumba'
    );
    expect(hasStarted(moved, istanbul(`${THU}T18:30:00`))).toBe(false);
    expect(hasStarted(moved, istanbul(`${THU}T19:30:00`))).toBe(true);
    expect(hasStarted(zumba, istanbul('2026-10-14T23:59:00'))).toBe(false);
    expect(hasStarted(zumba, istanbul('2026-10-16T00:00:00'))).toBe(true);
  });

  it('katıl / vazgeç yerel durumu: sayı, benimkiler, ad listesi', () => {
    const a = attendance({ counts: { [zumba.key]: 2 }, attendees: { [zumba.key]: ['x', 'y'] } });
    const joined = applyRsvp(a, zumba.key, 'me', true);
    expect(joined).toMatchObject({ mine: [zumba.key], counts: { [zumba.key]: 3 }, attendees: { [zumba.key]: ['x', 'y', 'me'] } });
    expect(applyRsvp(joined, zumba.key, 'me', true)).toBe(joined); // iki kez sayılmaz
    const left = applyRsvp(joined, zumba.key, 'me', false);
    expect(left).toMatchObject({ mine: [], counts: { [zumba.key]: 2 }, attendees: { [zumba.key]: ['x', 'y'] } });
    // Üyede ad listesi yok: eklenmez
    expect(applyRsvp(attendance(), cycle.key, 'me', true).attendees).toEqual({});
  });

  it('sunucudan gelenler: benimkiler ve katılanlar ayrılır', () => {
    const a = buildAttendance(
      'me',
      [
        { templateId: ZUMBA.id, date: THU, userId: 'me' },
        { templateId: ZUMBA.id, date: THU, userId: 'ali' },
        { templateId: CYCLE.id, date: THU, userId: 'ayse' },
      ],
      parseCountRows([
        { template_id: ZUMBA.id, date: THU, count: 2 },
        { template_id: CYCLE.id, date: THU, count: '1' },
        { template_id: 1, date: THU, count: 3 },
      ]),
      {}
    );
    expect(a.mine).toEqual([zumba.key]);
    expect(a.counts).toEqual({ [zumba.key]: 2, [cycle.key]: 1 });
    expect(a.attendees).toEqual({ [zumba.key]: ['me', 'ali'], [cycle.key]: ['ayse'] });
  });

  it('adlar yalnızca hoca / yöneticiye; adı olmayanlar sayılır', () => {
    const ms = [
      { gymId: GYM, role: 'trainer' as const },
      { gymId: 'g2', role: 'member' as const },
    ];
    expect(canSeeAttendees(GYM, ms)).toBe(true);
    expect(canSeeAttendees('g2', ms)).toBe(false);
    expect(attendeeNames(['a', 'b', 'c'], { a: 'Zeynep', b: 'Ali', c: null })).toBe('Ali, Zeynep ve 1 adı girilmemiş üye');
    expect(attendeeNames(['a'], {})).toBe('Adı girilmemiş üye');
    expect(attendeeNames(['a', 'b'], { a: ' ', b: null })).toBe('2 adı girilmemiş üye');
    expect(attendeeNames(['a', 'b'], { a: 'Ali', b: 'Can' })).toBe('Ali, Can');
  });

  it('önbellek: geri okunur, bozuksa yok', async () => {
    const data = new Map<string, string>();
    const store = { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => void data.set(k, v) };
    const a = attendance({ mine: ['k'], counts: { k: 3 }, attendees: { k: ['u'] }, names: { u: null } });
    await writeAttendanceCache(store, 'u1', a);
    expect(await readAttendanceCache(store, 'u1')).toEqual(a);
    expect(await readAttendanceCache(store, 'u2')).toBeNull();
    data.set('classes.attendance.u3', '{bozuk');
    expect(await readAttendanceCache(store, 'u3')).toBeNull();
  });

  it('sunucu hataları Türkçe', () => {
    expect(classifyAccountError({ code: 'P0001', message: 'class_cancelled' })).toBe('class_cancelled');
    expect(classifyAccountError({ code: 'P0001', message: 'class_started' })).toBe('class_started');
    expect(classifyAccountError({ code: 'P0001', message: 'class_not_scheduled' })).toBe('class_not_scheduled');
  });
});

describe('Hatırlatma zamanı', () => {
  it('ders 18:00 (İstanbul) → 17:00 İstanbul = 14:00 UTC', () => {
    expect(new Date(classStartMs(THU, '18:00')).toISOString()).toBe('2026-10-15T15:00:00.000Z');
    expect(new Date(reminderFireAtMs(occ(schedule(), 'Zumba'))).toISOString()).toBe('2026-10-15T14:00:00.000Z');
  });

  it('gece yarısına yakın ders: hatırlatma önceki gün değil aynı gün; 00:30 dersi önceki gün 23:30', () => {
    const early = tpl({ id: 'gece', weekday: 5, startTime: '00:30', name: 'Gece' });
    const o = occurrencesForDate({ templates: [early], exceptions: [] }, '2026-10-16')[0];
    expect(reminderFireAtMs(o)).toBe(istanbul('2026-10-15T23:30:00'));
  });

  it('telefon başka saat dilimindeyken aynı an', () => {
    const original = process.env.TZ;
    const results: number[] = [];
    try {
      for (const tz of ['Europe/Istanbul', 'America/New_York', 'Asia/Tokyo']) {
        process.env.TZ = tz;
        results.push(reminderFireAtMs(occ(schedule(), 'Zumba')));
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(istanbul(`${THU}T17:00:00`));
  });

  it('değişen saate göre: 19:30\'a alınan ders için 18:30', () => {
    const s = schedule([{ id: 'e', templateId: ZUMBA.id, gymId: GYM, date: THU, kind: 'changed', startTime: '19:30', instructorName: null, note: null }]);
    expect(reminderFireAtMs(occ(s, 'Zumba'))).toBe(istanbul(`${THU}T18:30:00`));
  });

  it('metin: "Zumba 18:00\'de başlıyor" + "Gelemeyeceksen yerini boşalt."', () => {
    expect(reminderContent({ name: 'Zumba', startTime: '18:00' })).toEqual({
      title: "Zumba 18:00'de başlıyor",
      body: 'Gelemeyeceksen yerini boşalt.',
    });
  });

  it('saat eki okunuşa göre', () => {
    expect(atTime('18:00')).toBe("18:00'de");
    expect(atTime('19:00')).toBe("19:00'da");
    expect(atTime('20:00')).toBe("20:00'de");
    expect(atTime('19:15')).toBe("19:15'te");
    expect(atTime('19:30')).toBe("19:30'da");
    expect(atTime('18:45')).toBe("18:45'te");
    expect(atTime('10:00')).toBe("10:00'da");
    expect(atTime('13:00')).toBe("13:00'te");
    expect(atTime('16:00')).toBe("16:00'da");
    expect(atTime('09:40')).toBe("09:40'ta");
    expect(atTime('00:00')).toBe("00:00'da");
    expect(atTime('07:50')).toBe("07:50'de");
  });
});

describe('Hatırlatma planı', () => {
  const now = istanbul(`${THU}T09:00:00`);

  it('katıldığım dersler için; zamanı geçmiş ve iptal edilmiş olanlar yok', () => {
    const cancelled = schedule([{ id: 'e', templateId: CYCLE.id, gymId: GYM, date: THU, kind: 'cancelled', startTime: null, instructorName: null, note: null }]);
    const mine = [`${ZUMBA.id}:${THU}`, `${CYCLE.id}:${THU}`, `${ZUMBA.id}:2026-10-08`];
    const plan = planReminders(myOccurrences(cancelled, mine), now);
    expect(plan.map((r) => [r.title, new Date(r.fireAtMs).toISOString()])).toEqual([
      ["Zumba 18:00'de başlıyor", '2026-10-15T14:00:00.000Z'],
    ]);
    expect(plan[0].data).toEqual({ type: 'class-reminder', gymId: GYM, templateId: ZUMBA.id, date: THU });
    expect(plan[0].id.startsWith(CLASS_REMINDER_PREFIX)).toBe(true);
    // Hatırlatma saati geçti ama ders başlamadı (17:30): planlanmaz
    expect(planReminders(myOccurrences(schedule(), mine.slice(0, 1)), istanbul(`${THU}T17:30:00`))).toEqual([]);
  });

  it('programdan kalkmış (pasif / silinmiş) dersin hatırlatması yok', () => {
    const s: ClassSchedule = { templates: [{ ...ZUMBA, active: false }], exceptions: [] };
    expect(myOccurrences(s, [`${ZUMBA.id}:${THU}`])).toEqual([]);
    expect(myOccurrences({ templates: [], exceptions: [] }, [`${ZUMBA.id}:${THU}`])).toEqual([]);
  });

  it('fark: vazgeçilen kalkar, yenisi eklenir, saati değişen yeniden planlanır, başkalarına dokunulmaz', () => {
    const [zumba] = planReminders(myOccurrences(schedule(), [`${ZUMBA.id}:${THU}`]), now);
    const [cycle] = planReminders(myOccurrences(schedule(), [`${CYCLE.id}:${THU}`]), now);
    const diff = diffReminders([cycle], [zumba.id, 'rest-end']);
    expect(diff.cancel).toEqual([zumba.id]); // dinlenme bildirimine dokunulmaz
    expect(diff.schedule).toEqual([cycle]);
    expect(diffReminders([zumba], [zumba.id])).toEqual({ cancel: [], schedule: [] });

    const moved = schedule([{ id: 'e', templateId: ZUMBA.id, gymId: GYM, date: THU, kind: 'changed', startTime: '19:30', instructorName: null, note: null }]);
    const [zumbaMoved] = planReminders(myOccurrences(moved, [`${ZUMBA.id}:${THU}`]), now);
    expect(diffReminders([zumbaMoved], [zumba.id])).toEqual({ cancel: [zumba.id], schedule: [zumbaMoved] });
  });

  it('bildirime dokununca hedef: o gün ve o ders', () => {
    expect(reminderTarget({ type: 'class-reminder', gymId: GYM, templateId: ZUMBA.id, date: THU })).toEqual({
      date: THU,
      key: `${ZUMBA.id}:${THU}`,
      gymId: GYM,
    });
    expect(reminderTarget({ type: 'rest' })).toBeNull();
    expect(reminderTarget(null)).toBeNull();
    expect(reminderTarget({ type: 'class-reminder', gymId: GYM, templateId: 'x', date: '15.10.2026' })).toBeNull();
  });
});

describe('Hatırlatma eşleştirici (sahte bildirim katmanı)', () => {
  function fakeApi(opts: { granted?: boolean; enabled?: boolean } = {}) {
    const scheduled = new Map<string, ClassReminder>([['rest-end', {} as ClassReminder]]);
    const state = { granted: opts.granted ?? true, enabled: opts.enabled ?? true };
    return {
      state,
      scheduled,
      api: {
        isGranted: async () => state.granted,
        isEnabled: async () => state.enabled,
        scheduledIds: async () => [...scheduled.keys()],
        schedule: async (r: ClassReminder) => void scheduled.set(r.id, r),
        cancel: async (id: string) => void scheduled.delete(id),
      },
    };
  }
  const now = () => istanbul(`${THU}T09:00:00`);
  const ids = (m: Map<string, unknown>) => [...m.keys()].filter((k) => k.startsWith(CLASS_REMINDER_PREFIX));

  it('katıl → planlanır; vazgeç → kalkar; dinlenme bildirimi yerinde', async () => {
    const f = fakeApi();
    const sync = createClassReminderSync(f.api, { now });
    await sync.sync(myOccurrences(schedule(), [`${ZUMBA.id}:${THU}`]));
    expect(ids(f.scheduled)).toHaveLength(1);
    await sync.sync(myOccurrences(schedule(), []));
    expect(ids(f.scheduled)).toEqual([]);
    expect(f.scheduled.has('rest-end')).toBe(true);
  });

  it('ders iptal edilince (program yenilenince) kalkar', async () => {
    const f = fakeApi();
    const sync = createClassReminderSync(f.api, { now });
    const mine = [`${ZUMBA.id}:${THU}`];
    await sync.sync(myOccurrences(schedule(), mine));
    const cancelled = schedule([{ id: 'e', templateId: ZUMBA.id, gymId: GYM, date: THU, kind: 'cancelled', startTime: null, instructorName: null, note: null }]);
    await sync.sync(myOccurrences(cancelled, mine));
    expect(ids(f.scheduled)).toEqual([]);
  });

  it('izin yoksa ya da anahtar kapalıysa planlanmaz, var olan kaldırılır (sessizce)', async () => {
    const f = fakeApi({ granted: false });
    const sync = createClassReminderSync(f.api, { now });
    await sync.sync(myOccurrences(schedule(), [`${ZUMBA.id}:${THU}`]));
    expect(ids(f.scheduled)).toEqual([]);

    f.state.granted = true;
    await sync.sync(myOccurrences(schedule(), [`${ZUMBA.id}:${THU}`]));
    expect(ids(f.scheduled)).toHaveLength(1);
    f.state.enabled = false;
    await sync.sync(myOccurrences(schedule(), [`${ZUMBA.id}:${THU}`]));
    expect(ids(f.scheduled)).toEqual([]);
  });

  it('art arda çağrılar sıraya girer; aynı bildirim iki kez planlanmaz; hata fırlatılmaz', async () => {
    const f = fakeApi();
    let scheduleCalls = 0;
    const errors: unknown[] = [];
    const sync = createClassReminderSync(
      {
        ...f.api,
        schedule: async (r) => {
          scheduleCalls++;
          await new Promise((res) => setTimeout(res, 5));
          f.scheduled.set(r.id, r);
        },
      },
      { now, onError: (e) => errors.push(e) }
    );
    const occ1 = myOccurrences(schedule(), [`${ZUMBA.id}:${THU}`]);
    await Promise.all([sync.sync(occ1), sync.sync(occ1), sync.sync(occ1)]);
    expect(scheduleCalls).toBe(1);

    const broken = createClassReminderSync(
      { ...f.api, scheduledIds: async () => Promise.reject(new Error('native')) },
      { now, onError: (e) => errors.push(e) }
    );
    await expect(broken.sync(occ1)).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
