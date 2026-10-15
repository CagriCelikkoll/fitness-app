/**
 * Gerçek Supabase test projesine (`dinc-test`) karşı çalışan araçların
 * ortak ortam yükleyicisi ve emniyet kontrolü (v3.2a).
 *
 * Testler ve `npm run test:db:reset` YALNIZCA şu koşullarda çalışır:
 * - `.env.test`'te dört değer de var;
 * - `.env`'deki gerçek proje URL'si okunabildi ve test URL'sinden FARKLI;
 * - veritabanı bağlantısı test projesini gösteriyor, gerçek projeyi değil;
 * - anahtarlar (JWT biçimindeyse) test projesine ait, rolleri doğru;
 *   test anon key'i gerçek projenin anon key'iyle aynı değil.
 *
 * Değerler hiçbir yerde yazdırılmaz. Düz Node (scripts/) ve Vitest aynı
 * dosyayı kullansın diye .mjs; tipleri guard.d.mts'te.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** KEY=değer satırları; # yorum, tırnaklar ve CRLF tolere edilir */
export function parseEnvText(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFile(name) {
  const file = path.join(ROOT, name);
  return existsSync(file) ? parseEnvText(readFileSync(file, 'utf8')) : null;
}

/** https://<ref>.supabase.co → ref; başka alan adıysa host */
export function projectRef(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.supabase.co') ? host.split('.')[0] : host;
  } catch {
    return null;
  }
}

function jwtPayload(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Saf kontrol: hata listesi döner (boşsa güvenli). Değer içermez.
 * @param {Record<string,string>|null} test  .env.test
 * @param {Record<string,string>|null} real  .env
 */
export function checkTestEnv(test, real) {
  const errors = [];
  if (!test) return ['.env.test bulunamadı (örnek: .env.test.example).'];
  const required = [
    'SUPABASE_TEST_URL',
    'SUPABASE_TEST_ANON_KEY',
    'SUPABASE_TEST_SERVICE_ROLE_KEY',
    'SUPABASE_TEST_DB_URL',
  ];
  for (const k of required) if (!test[k]) errors.push(`.env.test: ${k} boş.`);
  if (errors.length) return errors;

  const testRef = projectRef(test.SUPABASE_TEST_URL);
  if (!testRef) errors.push('SUPABASE_TEST_URL geçerli bir URL değil.');

  const realUrl = real?.EXPO_PUBLIC_SUPABASE_URL;
  if (!realUrl) {
    errors.push(
      'Gerçek proje URL’si (.env: EXPO_PUBLIC_SUPABASE_URL) okunamadı; test projesinin farklı olduğu doğrulanamadan çalışılmaz.'
    );
    return errors;
  }
  const realRef = projectRef(realUrl);
  if (!realRef) errors.push('.env: EXPO_PUBLIC_SUPABASE_URL geçerli bir URL değil.');
  if (testRef && realRef && testRef === realRef) {
    errors.push('TEST PROJESİ GERÇEK PROJEYLE AYNI. .env.test başka bir Supabase projesini göstermeli.');
  }

  const db = test.SUPABASE_TEST_DB_URL.toLowerCase();
  if (testRef && !db.includes(testRef)) {
    errors.push('SUPABASE_TEST_DB_URL test projesinin kimliğini (ref) içermiyor.');
  }
  if (realRef && realRef !== testRef && db.includes(realRef)) {
    errors.push('SUPABASE_TEST_DB_URL GERÇEK projeyi gösteriyor.');
  }

  const checkKey = (name, key, role) => {
    // Biçim: eski JWT ya da yeni sb_publishable_ / sb_secret_ anahtarı
    const wantPrefix = role === 'anon' ? 'sb_publishable_' : 'sb_secret_';
    const otherPrefix = role === 'anon' ? 'sb_secret_' : 'sb_publishable_';
    if (key.startsWith(otherPrefix)) {
      errors.push(`${name} yanlış türde anahtar (${otherPrefix}…); ${wantPrefix}… ya da eski JWT olmalı.`);
      return;
    }
    const p = jwtPayload(key);
    if (!p && !key.startsWith(wantPrefix)) {
      errors.push(
        `${name} bir Supabase anahtarına benzemiyor (doldurulmamış olabilir). ${wantPrefix}… ya da eski JWT (eyJ…) bekleniyor: Project Settings → API Keys.`
      );
      return;
    }
    if (!p) return; // yeni biçim (sb_…) anahtarlarda proje bilgisi yok
    if (p.ref && testRef && p.ref !== testRef) errors.push(`${name} başka bir projeye ait.`);
    if (p.role && p.role !== role) errors.push(`${name} rolü "${role}" değil.`);
  };
  checkKey('SUPABASE_TEST_ANON_KEY', test.SUPABASE_TEST_ANON_KEY, 'anon');
  checkKey('SUPABASE_TEST_SERVICE_ROLE_KEY', test.SUPABASE_TEST_SERVICE_ROLE_KEY, 'service_role');
  if (real?.EXPO_PUBLIC_SUPABASE_ANON_KEY && real.EXPO_PUBLIC_SUPABASE_ANON_KEY === test.SUPABASE_TEST_ANON_KEY) {
    errors.push('Test anon key’i gerçek projenin anon key’iyle aynı.');
  }
  if (test.SUPABASE_TEST_SERVICE_ROLE_KEY === test.SUPABASE_TEST_ANON_KEY) {
    errors.push('Service role key ile anon key aynı.');
  }
  return errors;
}

/** Kontrolden geçerse ortam; geçmezse fırlatır (hiçbir istek atılmadan) */
export function loadTestEnv() {
  const test = readEnvFile('.env.test');
  const errors = checkTestEnv(test, readEnvFile('.env'));
  if (errors.length) {
    throw new Error(`Gerçek sunucu testleri durduruldu:\n- ${errors.join('\n- ')}`);
  }
  return {
    url: test.SUPABASE_TEST_URL,
    anonKey: test.SUPABASE_TEST_ANON_KEY,
    serviceRoleKey: test.SUPABASE_TEST_SERVICE_ROLE_KEY,
    dbUrl: test.SUPABASE_TEST_DB_URL,
    ref: projectRef(test.SUPABASE_TEST_URL),
  };
}
