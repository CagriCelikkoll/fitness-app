/**
 * Gerçek sunucu testlerinin emniyeti (v3.2a) — normal `npm test`'in
 * parçası, ağ yok:
 * - Service role key uygulama koduna girmiyor: `src/` ve `app/` içinde
 *   `SERVICE_ROLE` geçmiyor; `.env.test`'teki anahtarın kendisi de uygulama
 *   dosyalarında ve `.env`'de yok.
 * - Koruma (test/integration/guard.mjs) gerçek projeye karşı çalışmayı
 *   ve eksik / yer tutucu / yanlış türde anahtarı reddediyor.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT, checkTestEnv, parseEnvText } from './integration/guard.mjs';

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(name)) out.push(full);
  }
  return out;
}

const APP_FILES = [
  ...filesUnder(path.join(ROOT, 'src')),
  ...filesUnder(path.join(ROOT, 'app')),
  path.join(ROOT, 'app.json'),
  path.join(ROOT, 'eas.json'),
].filter((f) => existsSync(f));

describe('service role key uygulamaya girmiyor', () => {
  it('src/ ve app/ içinde SERVICE_ROLE geçmiyor', () => {
    const hits = APP_FILES.filter((f) => readFileSync(f, 'utf8').includes('SERVICE_ROLE')).map((f) =>
      path.relative(ROOT, f)
    );
    expect(hits).toEqual([]);
  });

  it('.env (uygulama paketine giren) service role içermiyor', () => {
    const envFile = path.join(ROOT, '.env');
    if (!existsSync(envFile)) return;
    const env = parseEnvText(readFileSync(envFile, 'utf8'));
    expect(Object.keys(env).filter((k) => /SERVICE|SECRET/i.test(k))).toEqual([]);
    expect(Object.values(env).filter((v) => v.startsWith('sb_secret_'))).toEqual([]);
  });

  it('.env.test’teki service key değeri uygulama dosyalarında ve .env’de yok', () => {
    const testFile = path.join(ROOT, '.env.test');
    if (!existsSync(testFile)) return;
    const key = parseEnvText(readFileSync(testFile, 'utf8')).SUPABASE_TEST_SERVICE_ROLE_KEY ?? '';
    if (key.length < 20) return; // doldurulmamış
    const files = [...APP_FILES, path.join(ROOT, '.env')].filter((f) => existsSync(f));
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes(key)).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('.env.test git’e girmiyor (.gitignore)', () => {
    const ignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('.env.test');
  });
});

const jwt = (payload: object) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'imza'].join('.');

const TEST = {
  SUPABASE_TEST_URL: 'https://testref123.supabase.co',
  SUPABASE_TEST_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwx',
  SUPABASE_TEST_SERVICE_ROLE_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz',
  SUPABASE_TEST_DB_URL: 'postgresql://postgres.testref123:sifre@aws-0-eu.pooler.supabase.com:6543/postgres',
};
const REAL = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://realref456.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_gercekgercekgercekgercek',
};

describe('gerçek projeye karşı çalışma engeli', () => {
  it('doğru ayrı test projesi: geçiyor', () => {
    expect(checkTestEnv(TEST, REAL)).toEqual([]);
    expect(
      checkTestEnv(
        {
          ...TEST,
          SUPABASE_TEST_ANON_KEY: jwt({ ref: 'testref123', role: 'anon' }),
          SUPABASE_TEST_SERVICE_ROLE_KEY: jwt({ ref: 'testref123', role: 'service_role' }),
          SUPABASE_TEST_DB_URL: 'postgresql://postgres:sifre@db.testref123.supabase.co:5432/postgres',
        },
        REAL
      )
    ).toEqual([]);
  });

  it('test URL’si gerçek projeyle aynıysa duruyor', () => {
    const errors = checkTestEnv(
      { ...TEST, SUPABASE_TEST_URL: REAL.EXPO_PUBLIC_SUPABASE_URL },
      REAL
    );
    expect(errors.join(' ')).toMatch(/GERÇEK PROJEYLE AYNI/);
  });

  it('veritabanı bağlantısı gerçek projeyi gösteriyorsa duruyor', () => {
    const errors = checkTestEnv(
      { ...TEST, SUPABASE_TEST_DB_URL: 'postgresql://postgres:x@db.realref456.supabase.co:5432/postgres' },
      REAL
    );
    expect(errors.join(' ')).toMatch(/GERÇEK projeyi|test projesinin kimliğini/);
  });

  it('gerçek proje bilinmiyorsa (.env yok) karşılaştırma yapılamadığı için duruyor', () => {
    expect(checkTestEnv(TEST, null).join(' ')).toMatch(/doğrulanamadan çalışılmaz/);
  });

  it('.env.test yoksa / değer boşsa duruyor', () => {
    expect(checkTestEnv(null, REAL)).toHaveLength(1);
    expect(checkTestEnv({ ...TEST, SUPABASE_TEST_SERVICE_ROLE_KEY: '' }, REAL).join(' ')).toMatch(/boş/);
  });

  it('yer tutucu ya da yanlış türde anahtar: duruyor', () => {
    expect(checkTestEnv({ ...TEST, SUPABASE_TEST_SERVICE_ROLE_KEY: 'BURAYA_YAPISTIR' }, REAL).join(' ')).toMatch(
      /benzemiyor/
    );
    expect(
      checkTestEnv({ ...TEST, SUPABASE_TEST_SERVICE_ROLE_KEY: 'sb_publishable_abcdefghijklmnop' }, REAL).join(' ')
    ).toMatch(/yanlış türde/);
    expect(
      checkTestEnv({ ...TEST, SUPABASE_TEST_SERVICE_ROLE_KEY: jwt({ ref: 'realref456', role: 'service_role' }) }, REAL).join(' ')
    ).toMatch(/başka bir projeye ait/);
    expect(
      checkTestEnv({ ...TEST, SUPABASE_TEST_SERVICE_ROLE_KEY: jwt({ ref: 'testref123', role: 'anon' }) }, REAL).join(' ')
    ).toMatch(/rolü "service_role" değil/);
  });

  it('test anon key’i gerçek projeninkiyle aynıysa duruyor', () => {
    expect(
      checkTestEnv({ ...TEST, SUPABASE_TEST_ANON_KEY: REAL.EXPO_PUBLIC_SUPABASE_ANON_KEY }, REAL).join(' ')
    ).toMatch(/gerçek projenin anon key/);
  });

  it('hata mesajları anahtar ya da şifre değeri içermiyor', () => {
    const all = [
      ...checkTestEnv({ ...TEST, SUPABASE_TEST_URL: REAL.EXPO_PUBLIC_SUPABASE_URL }, REAL),
      ...checkTestEnv({ ...TEST, SUPABASE_TEST_SERVICE_ROLE_KEY: 'BURAYA_YAPISTIR' }, REAL),
    ].join(' ');
    for (const secret of ['sifre', TEST.SUPABASE_TEST_ANON_KEY, 'BURAYA_YAPISTIR']) {
      expect(all).not.toContain(secret);
    }
  });
});
