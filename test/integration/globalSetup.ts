/**
 * Entegrasyon testlerinden önce bir kez (v3.2a):
 * 1. Emniyet kontrolü (guard.mjs): test projesi gerçek projeden farklı
 *    değilse hiçbir istek atılmadan durur.
 * 2. Önceki (yarıda kalmış) çalıştırmalardan kalan test kullanıcıları
 *    silinir: e-postası TEST_EMAIL_PREFIX ile başlayanlar. Başka
 *    kullanıcıya dokunulmaz.
 */

import { createClient } from '@supabase/supabase-js';

import { loadTestEnv } from './guard.mjs';

export const TEST_EMAIL_PREFIX = 'dinc-int+';

export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let removed = 0;
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Test kullanıcıları listelenemedi: ${error.message}`);
    const leftovers = data.users.filter((u) => u.email?.startsWith(TEST_EMAIL_PREFIX));
    for (const u of leftovers) {
      await admin.auth.admin.deleteUser(u.id);
      removed += 1;
    }
    if (data.users.length < 200) break;
  }
  // Önceki çalıştırmanın salonları (test kullanıcıları silinince üyesiz kalır)
  await admin.from('gyms').delete().like('name', 'INT %');
  console.log(`[entegrasyon] Test projesi: ${env.ref}; kalan ${removed} test kullanıcısı silindi.`);
}
