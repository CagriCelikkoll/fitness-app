import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Gerçek Supabase test projesine karşı entegrasyon testleri (v3.2a).
 * `npm run test:integration`; normal `npm test`'e girmez (ağ ve anahtar
 * ister). Ortam ve emniyet: test/integration/guard.mjs.
 *
 * Dosyalar sırayla çalışır: aynı projede, aynı IP'den; Supabase'in
 * giriş sınırına (5 dk'da ~30) takılmamak için kullanıcılar dosya başına
 * bir kez giriş yapıyor.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      // Gerçek sunucuda kimlikler gerçekten tekil olsun (sayaç değil)
      'expo-crypto': path.resolve(root, 'test/integration/cryptoStub.ts'),
    },
  },
  test: {
    include: ['test/integration/**/*.int.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    globalSetup: ['test/integration/globalSetup.ts'],
  },
});
