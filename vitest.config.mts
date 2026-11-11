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
    // Kararlılık (v4.0a): varsayılan işçi sayısı (çekirdek − 1 = 15) Windows'ta
    // diski ve CPU'yu tıkıyordu; tek başına 30 ms süren dosya taramaları ve
    // eşitleme testleri tam koşuda 5–16 sn'ye çıkıp rastgele zaman aşımına
    // düşüyordu (her koşuda başka bir test). Yarı çekirdekle tam koşu hem
    // daha hızlı hem kararlı. Süre sınırı da yük dalgalanmasına pay olarak
    // 15 sn (asılı kalan test yine yakalanır; en yavaş test ~2,5 sn).
    maxWorkers: '50%',
    testTimeout: 15_000,
  },
});
