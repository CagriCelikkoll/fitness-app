/**
 * Aydınlatma metni onayı (v3.7, KVKK) ve 0014 migration'ının metinle
 * denetlenebilen kısımları. Sunucu davranışı: test/integration/
 * authHardening.int.ts.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEGAL_CONTACT, PRIVACY_NOTICE_VERSION } from '@/content/legal';
import {
  PENDING_ACK_KEY,
  PRIVACY_NOTICE_CHECKBOX,
  ackPrivacyNotice,
  clearPendingAck,
  fetchPrivacyAck,
  needsPrivacyAck,
  parsePrivacyAckRows,
  privacyAckCardText,
  readPendingAck,
  savePendingAck,
} from '@/lib/privacyNotice';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

describe('sürüm', () => {
  it('YYYY-AA-GG ve yasal metnin yürürlük tarihiyle aynı gün', () => {
    expect(PRIVACY_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [day, month, year] = LEGAL_CONTACT.effectiveDate.split(' ');
    const m = TR_MONTHS.indexOf(month!) + 1;
    expect(m).toBeGreaterThan(0);
    expect(PRIVACY_NOTICE_VERSION).toBe(`${year}-${String(m).padStart(2, '0')}-${day!.padStart(2, '0')}`);
  });

  it('yeniden sorma: kayıt yok / eski → evet; aynı / daha yeni → hayır', () => {
    expect(needsPrivacyAck(null, '2026-10-15')).toBe(true);
    expect(needsPrivacyAck(undefined, '2026-10-15')).toBe(true);
    expect(needsPrivacyAck('bozuk', '2026-10-15')).toBe(true);
    expect(needsPrivacyAck('2026-01-01', '2026-10-15')).toBe(true);
    expect(needsPrivacyAck('2026-10-15', '2026-10-15')).toBe(false);
    expect(needsPrivacyAck('2027-01-01', '2026-10-15')).toBe(false);
  });

  it('kart metni: hiç onay yok / metin güncellendi', () => {
    expect(privacyAckCardText(null).title).toBe('Aydınlatma Metni');
    expect(privacyAckCardText('2026-01-01').title).toBe('Aydınlatma Metni güncellendi');
  });
});

describe('aydınlatma, açık rıza değil', () => {
  it('kutu "okudum" diyor; kabul / rıza / onaylıyorum demiyor', () => {
    expect(PRIVACY_NOTICE_CHECKBOX).toBe("Aydınlatma Metni'ni okudum.");
    const texts = [
      PRIVACY_NOTICE_CHECKBOX,
      ...Object.values(privacyAckCardText(null)),
      ...Object.values(privacyAckCardText('2026-01-01')),
    ];
    for (const t of texts) expect(t).not.toMatch(/kabul|rıza|onaylıyorum/i);
  });

  it('giriş ekranı: kutu "Kodu gönder"in üstünde, işaretlenmeden kod gönderilmiyor, iki bağlantı var', () => {
    const screen = read('app/account/sign-in.tsx');
    expect(screen.indexOf('PRIVACY_NOTICE_CHECKBOX}')).toBeGreaterThan(0);
    expect(screen.indexOf('PRIVACY_NOTICE_CHECKBOX}')).toBeLessThan(screen.indexOf("'Kodu gönder'"));
    expect(screen).toContain('<LegalLink to="privacy"');
    expect(screen).toContain("params: { doc: 'kvkk' }");
    expect(screen).not.toMatch(/kabul ediyorum|rıza veriyorum/i);
  });
});

describe('bekleyen onay (cihazda)', () => {
  const store = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
      removeItem: async (k: string) => void data.delete(k),
    };
  };

  it('yaz → oku → sil', async () => {
    const s = store();
    expect(await readPendingAck(s)).toBeNull();
    await savePendingAck(s, '2026-10-15');
    expect(s.data.get(PENDING_ACK_KEY)).toBe('2026-10-15');
    expect(await readPendingAck(s)).toBe('2026-10-15');
    await clearPendingAck(s);
    expect(await readPendingAck(s)).toBeNull();
  });

  it('bozuk değer yok sayılır', async () => {
    const s = store();
    s.data.set(PENDING_ACK_KEY, 'evet');
    expect(await readPendingAck(s)).toBeNull();
  });
});

describe('Supabase çağrıları', () => {
  it('onay RPC ile, sürüm parametresiyle', async () => {
    const calls: unknown[] = [];
    const client = {
      rpc: async (name: string, args: unknown) => {
        calls.push([name, args]);
        return { data: null, error: null };
      },
    } as unknown as Parameters<typeof ackPrivacyNotice>[0];
    expect(await ackPrivacyNotice(client)).toEqual({ ok: true, value: null });
    expect(calls).toEqual([['ack_privacy_notice', { p_version: PRIVACY_NOTICE_VERSION }]]);
  });

  it('okuma: satır / boş / bozuk', async () => {
    expect(parsePrivacyAckRows([{ privacy_version: '2026-10-15', privacy_ack_at: '2026-11-07T10:00:00Z' }])).toEqual({
      version: '2026-10-15',
      ackAt: '2026-11-07T10:00:00Z',
    });
    expect(parsePrivacyAckRows([])).toEqual({ version: null, ackAt: null });
    expect(parsePrivacyAckRows([{ privacy_version: 'x', privacy_ack_at: 5 }])).toEqual({ version: null, ackAt: null });
  });

  it('istemci yoksa not_configured', async () => {
    expect(await ackPrivacyNotice(null)).toMatchObject({ ok: false, error: { kind: 'not_configured' } });
    expect(await fetchPrivacyAck(null)).toMatchObject({ ok: false, error: { kind: 'not_configured' } });
  });
});

describe('0014_auth_hardening.sql', () => {
  const sql = read('supabase/migrations/0014_auth_hardening.sql');

  it('şifre: auth.users ekleme ve şifre güncellemesinde boşaltılıyor (DNC-09)', () => {
    expect(sql).toMatch(/before insert or update of encrypted_password on auth\.users/);
    expect(sql).toContain("new.encrypted_password := ''");
    expect(sql).toMatch(/revoke execute on function public\.strip_auth_password\(\) from public, anon, authenticated/);
  });

  it('kayıtta gelen ad profile yazılmıyor', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.handle_new_user()'));
    const body = fn.slice(0, fn.indexOf('$$;'));
    expect(body).toContain('insert into public.profiles (id) values (new.id);');
    expect(body).not.toContain('raw_user_meta_data');
  });

  it('Türkçe harf denetimi, ad temizliğinden önce', () => {
    expect(sql.indexOf('Çağrı Şükrü Öğüt İnce')).toBeGreaterThan(0);
    expect(sql.indexOf('Çağrı Şükrü Öğüt İnce')).toBeLessThan(sql.indexOf('update public.profiles'));
  });

  it('onay sütunları yalnızca RPC ile; hoca / yönetici göremiyor', () => {
    expect(sql).toContain('add column privacy_version text');
    expect(sql).toContain('add column privacy_ack_at timestamptz');
    expect(sql).toContain('revoke select on table public.profiles from authenticated;');
    expect(sql).toContain('grant select (id, display_name, created_at) on table public.profiles to authenticated;');
    expect(sql).toMatch(/grant execute on function public\.ack_privacy_notice\(text\) to authenticated/);
    expect(sql).toMatch(/grant execute on function public\.my_privacy_ack\(\) to authenticated/);
  });

  it('istemci profiles\'tan yalnızca izinli sütunları okuyor', () => {
    for (const rel of ['src/lib/profile.ts', 'src/lib/gymAdmin.ts', 'src/lib/classRsvps.ts']) {
      const src = read(rel);
      const selects = [...src.matchAll(/from\('profiles'\)\s*\.select\('([^']*)'\)/g)].map((m) => m[1]!);
      for (const cols of selects) {
        for (const col of cols.split(',').map((c) => c.trim())) {
          expect(['id', 'display_name', 'created_at'], `${rel}: ${col}`).toContain(col);
        }
      }
    }
  });
});
