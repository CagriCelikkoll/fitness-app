import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // tsconfig'teki "@/*" → "src/*" eşlemesinin Vitest karşılığı
      '@': path.resolve(root, 'src'),
      // src/lib/id.ts expo-crypto'yu import ediyor; Node'da böyle bir
      // modül yok. Testlerde gerçek UUID'ye ihtiyaç yok, öngörülebilir
      // bir üreteç yeterli (bkz. test/stubs/expo-crypto.ts).
      'expo-crypto': path.resolve(root, 'test/stubs/expo-crypto.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
