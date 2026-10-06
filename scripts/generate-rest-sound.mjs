/**
 * Dinlenme bitiş sesini üretir: assets/sounds/rest-done.wav
 *
 * Lisans derdi olmasın diye ses dışarıdan alınmıyor; burada sıfırdan
 * hesaplanan kısa bir sinüs tonu. Değiştirmek için değerleri düzenleyip
 * `node scripts/generate-rest-sound.mjs` çalıştır.
 *
 * 16 bit mono PCM WAV. Başta ve sonda kısa yumuşatma var: ton aniden
 * başlayıp kesilince hoparlörde "tık" sesi çıkıyor.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const DURATION_S = 0.3;
const FREQUENCY_HZ = 880; // A5 — salon gürültüsünde seçilebilecek kadar tiz
const AMPLITUDE = 0.6;
const FADE_IN_S = 0.005;
const FADE_OUT_S = 0.08;

const sampleCount = Math.round(SAMPLE_RATE * DURATION_S);
const dataSize = sampleCount * 2;
const buf = Buffer.alloc(44 + dataSize);

// RIFF başlığı
buf.write('RIFF', 0, 'ascii');
buf.writeUInt32LE(36 + dataSize, 4);
buf.write('WAVE', 8, 'ascii');
// fmt bloğu: PCM, mono, 16 bit
buf.write('fmt ', 12, 'ascii');
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SAMPLE_RATE, 24);
buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
// data bloğu
buf.write('data', 36, 'ascii');
buf.writeUInt32LE(dataSize, 40);

for (let i = 0; i < sampleCount; i += 1) {
  const t = i / SAMPLE_RATE;
  const envelope = Math.min(1, t / FADE_IN_S, (DURATION_S - t) / FADE_OUT_S);
  const value = Math.sin(2 * Math.PI * FREQUENCY_HZ * t) * AMPLITUDE * envelope;
  buf.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'assets', 'sounds', 'rest-done.wav');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`${path.relative(root, out)} yazıldı (${buf.length} bayt)`);
