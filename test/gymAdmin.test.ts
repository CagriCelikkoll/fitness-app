/**
 * Yönetici: üye ve salon yönetimi (v3.2d) — saf mantık: filtreler (7 gün
 * içinde bitenler, bitmişler), arama, sayılar, üyelik uyarısı metni ve
 * gün hesabı (salon takvimi, UTC+3), paylaşım metni, ad / renk.
 * Sunucu kuralları: test/integration/gymAdmin.int.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  GYM_COLORS,
  canEditMember,
  canManageGym,
  canViewMembers,
  filterMembers,
  gymNameError,
  isGymColor,
  joinCodeShareText,
  matchesFilter,
  memberCountsText,
  membershipDaysLeft,
  membershipWarning,
  parseMemberRows,
  withDative,
  type GymMember,
} from '@/lib/gymAdmin';

/** Salonda (UTC+3) verilen yerel an */
const istanbul = (iso: string) => Date.parse(`${iso}+03:00`);
const NOW = istanbul('2026-10-14T12:00:00');

const m = (userId: string, over: Partial<GymMember> = {}): GymMember => ({
  userId,
  name: null,
  role: 'member',
  joinedAt: '2026-01-01T00:00:00Z',
  membershipEndsOn: null,
  ...over,
});

describe('Üyelik bitişi: gün hesabı (salon takvimi)', () => {
  it('kalan gün; bitiş günü dahil (o gün 0)', () => {
    expect(membershipDaysLeft('2026-10-19', NOW)).toBe(5);
    expect(membershipDaysLeft('2026-10-14', NOW)).toBe(0);
    expect(membershipDaysLeft('2026-10-13', NOW)).toBe(-1);
    expect(membershipDaysLeft(null, NOW)).toBeNull();
    expect(membershipDaysLeft('bozuk', NOW)).toBeNull();
  });

  it('gece yarısı salon saatiyle döner (telefonun diliminden bağımsız)', () => {
    // UTC 20:59 = İstanbul 23:59 (14 Ekim); UTC 21:00 = İstanbul 00:00 (15 Ekim)
    expect(membershipDaysLeft('2026-10-15', Date.parse('2026-10-14T20:59:00Z'))).toBe(1);
    expect(membershipDaysLeft('2026-10-15', Date.parse('2026-10-14T21:00:00Z'))).toBe(0);
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(membershipDaysLeft('2026-10-15', Date.parse('2026-10-14T21:00:00Z'))).toBe(0);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('ay ve yıl sınırı', () => {
    expect(membershipDaysLeft('2027-01-02', istanbul('2026-12-30T10:00:00'))).toBe(3);
    expect(membershipDaysLeft('2026-11-01', istanbul('2026-10-30T10:00:00'))).toBe(2);
  });
});

describe('Üye tarafı: ana sayfa uyarısı', () => {
  it('7 gün ya da daha yakınsa', () => {
    expect(membershipWarning('2026-10-19', NOW)).toEqual({ ended: false, text: 'Üyeliğin 5 gün sonra bitiyor.' });
    expect(membershipWarning('2026-10-21', NOW)).toEqual({ ended: false, text: 'Üyeliğin 7 gün sonra bitiyor.' });
    expect(membershipWarning('2026-10-15', NOW)).toEqual({ ended: false, text: 'Üyeliğin yarın bitiyor.' });
    expect(membershipWarning('2026-10-14', NOW)).toEqual({ ended: false, text: 'Üyeliğin bugün bitiyor.' });
  });

  it('bittiyse tarihle; ay adının eki doğru', () => {
    expect(membershipWarning('2026-10-12', NOW)).toEqual({ ended: true, text: "Üyeliğin 12 Ekim'de bitti." });
    expect(membershipWarning('2026-03-03', NOW)?.text).toBe("Üyeliğin 3 Mart'ta bitti.");
    expect(membershipWarning('2026-09-30', NOW)?.text).toBe("Üyeliğin 30 Eylül'de bitti.");
    expect(membershipWarning('2026-06-01', NOW)?.text).toBe("Üyeliğin 1 Haziran'da bitti.");
    expect(membershipWarning('2025-12-20', NOW)?.text).toBe('Üyeliğin bitti (20 Aralık 2025).');
  });

  it('uzaksa ya da bitiş yoksa hiçbir şey', () => {
    expect(membershipWarning('2026-10-22', NOW)).toBeNull();
    expect(membershipWarning(null, NOW)).toBeNull();
  });
});

describe('Üye listesi', () => {
  const list = [
    m('a', { name: 'Ayşe', membershipEndsOn: '2026-10-20' }), // 6 gün
    m('b', { name: 'Burak', membershipEndsOn: '2026-10-14' }), // bugün son gün
    m('c', { name: 'Can', membershipEndsOn: '2026-10-13' }), // bitti
    m('d', { name: 'İpek', role: 'trainer', membershipEndsOn: '2026-12-01' }),
    m('e', { name: 'Işıl', role: 'trainer' }),
    m('f', { name: 'Zeki', role: 'admin' }),
    m('g', { membershipEndsOn: '2026-10-21' }), // adsız, 7 gün
    m('h', { membershipEndsOn: '2026-10-22' }), // 8 gün
  ];

  it('filtreler: 7 gün içinde bitenler (bugün ve 7. gün dahil), bitmişler', () => {
    const ids = (f: Parameters<typeof matchesFilter>[1]) => list.filter((x) => matchesFilter(x, f, NOW)).map((x) => x.userId);
    expect(ids('expiring')).toEqual(['a', 'b', 'g']);
    expect(ids('expired')).toEqual(['c']);
    expect(ids('trainers')).toEqual(['d', 'e']);
    expect(ids('admins')).toEqual(['f']);
    expect(ids('all')).toHaveLength(8);
  });

  it('sıralama: yönetici, hoca, üye; adsızlar sonda', () => {
    expect(filterMembers(list, 'all', '', NOW).map((x) => x.userId)).toEqual(['f', 'e', 'd', 'a', 'b', 'c', 'g', 'h']);
  });

  it('arama ada göre, Türkçe harflerle (İ/i, I/ı)', () => {
    expect(filterMembers(list, 'all', 'ipek', NOW).map((x) => x.userId)).toEqual(['d']);
    expect(filterMembers(list, 'all', 'IŞIL', NOW).map((x) => x.userId)).toEqual(['e']);
    expect(filterMembers(list, 'all', '  ay ', NOW).map((x) => x.userId)).toEqual(['a']);
    expect(filterMembers(list, 'trainers', 'ay', NOW)).toEqual([]);
    // Adsızlar aramada çıkmaz
    expect(filterMembers(list, 'all', 'x', NOW)).toEqual([]);
  });

  it('sayılar', () => {
    expect(memberCountsText(list)).toBe('5 üye · 2 hoca · 1 yönetici');
    expect(memberCountsText([m('x', { role: 'admin' })])).toBe('1 yönetici');
    expect(memberCountsText([])).toBe('Üye yok');
  });

  it('satırlar ve adlar', () => {
    expect(
      parseMemberRows(
        [
          { user_id: 'u1', role: 'trainer', joined_at: 'j', membership_ends_on: '2026-11-01' },
          { user_id: 'u2', role: 'patron' },
          { user_id: 'u3', role: 'member' },
        ],
        { u1: 'Ali', u3: '  ' }
      )
    ).toEqual([
      { userId: 'u1', name: 'Ali', role: 'trainer', joinedAt: 'j', membershipEndsOn: '2026-11-01' },
      { userId: 'u3', name: null, role: 'member', joinedAt: null, membershipEndsOn: null },
    ]);
  });
});

describe('Görünüm yetkileri', () => {
  const ms = [
    { gymId: 'A', role: 'admin' as const },
    { gymId: 'T', role: 'trainer' as const },
    { gymId: 'M', role: 'member' as const },
  ];

  it('liste hoca ve yöneticiye; düzenleme yalnızca yöneticiye', () => {
    expect([canViewMembers('A', ms), canViewMembers('T', ms), canViewMembers('M', ms), canViewMembers('X', ms)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([canManageGym('A', ms), canManageGym('T', ms), canManageGym('M', ms)]).toEqual([true, false, false]);
  });

  it('yönetici kendini düzenlemez (rol düşürme / çıkarma)', () => {
    expect(canEditMember({ userId: 'me' }, 'me')).toBe(false);
    expect(canEditMember({ userId: 'other' }, 'me')).toBe(true);
    expect(canEditMember({ userId: 'other' }, null)).toBe(false);
  });
});

describe('Salon ayarları', () => {
  it('ad 2–40', () => {
    expect(gymNameError('A')).toMatch(/en az 2/);
    expect(gymNameError('  A  ')).toMatch(/en az 2/);
    expect(gymNameError('Test Salonu')).toBeNull();
    expect(gymNameError('x'.repeat(41))).toMatch(/en fazla 40/);
  });

  it('9 hazır renk (v3.5: Fuşya), tekil, #RRGGBB (sunucu kısıtıyla aynı biçim)', () => {
    expect(GYM_COLORS).toHaveLength(9);
    expect(new Set(GYM_COLORS.map((c) => c.hex)).size).toBe(9);
    for (const c of GYM_COLORS) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(isGymColor('#D7FF3E')).toBe(true);
    expect(isGymColor('#123456')).toBe(false);
    expect(isGymColor(null)).toBe(false);
  });

  it('paylaşım metni ve yönelme eki', () => {
    expect(joinCodeShareText('Test Salonu', 'K7M2QX')).toBe("Dinç uygulamasında Test Salonu'na katılmak için kod: K7M2QX");
    expect(withDative('Spor Merkezi')).toBe("Spor Merkezi'ne");
    expect(withDative('Atlas')).toBe("Atlas'a");
    expect(withDative('Arena')).toBe("Arena'ya");
    expect(withDative('Güç Evi')).toBe("Güç Evi'ne");
    expect(withDative('Dinç Gym')).toBe("Dinç Gym'e");
    expect(withDative('Kartal Fitness')).toBe("Kartal Fitness'e");
  });
});
