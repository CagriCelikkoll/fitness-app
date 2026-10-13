/**
 * npm run test:db:reset (v3.2a)
 *
 * Supabase TEST projesinde (`.env.test`) public şemasını sıfırlar ve
 * supabase/migrations/ altındaki bütün dosyaları ad sırasıyla uygular.
 * Gerçek projeye migration uygulamak yine kullanıcının elinde (SQL Editor).
 *
 * - Emniyet: test/integration/guard.mjs; test projesinin gerçek projeden
 *   farklı olduğu doğrulanmadan bağlantı bile açılmaz.
 * - auth şemasına dokunulmaz. `drop schema public cascade`, 0001'in
 *   auth.users üzerinde kurduğu trigger'ı da (public fonksiyonuna bağlı)
 *   götürür; 0001 yeniden kurar.
 * - Her migration kendi transaction'ında; biri hata verirse durur ve hangi
 *   dosya olduğunu söyler.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { ROOT, loadTestEnv } from '../test/integration/guard.mjs';

const env = loadTestEnv();
const dir = path.join(ROOT, 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } });

const RESET = `
  drop schema if exists public cascade;
  create schema public;
  grant usage on schema public to postgres, anon, authenticated, service_role;
  grant all on schema public to postgres, service_role;
  alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
`;

async function inTransaction(label, sql) {
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log(`  ✓ ${label}`);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error(`  ✗ ${label}: ${err.message}`);
    throw err;
  }
}

try {
  await client.connect();
  console.log(`Test projesi: ${env.ref}`);
  await inTransaction('public şeması sıfırlandı', RESET);
  for (const f of files) {
    await inTransaction(f, readFileSync(path.join(dir, f), 'utf8'));
  }
  // PostgREST yeni tabloları / fonksiyonları hemen görsün
  await client.query(`notify pgrst, 'reload schema'`);
  console.log(`Bitti: ${files.length} migration uygulandı.`);
} catch {
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
