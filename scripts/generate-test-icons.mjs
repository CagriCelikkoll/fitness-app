/**
 * "Dinç Test" ikonları (v4.0a ek): mevcut ikonların işareti yukarı kaydırılır,
 * altına kenardan kenara amber "TEST" şeridi çizilir. Kaynaklara dokunmaz;
 * çıktı `assets/brand/test/`. Çalıştırma: `node scripts/generate-test-icons.mjs`
 *
 * Adaptif ikonda yazı Android'in güvenli dairesinin (çap 66/108) içinde kalır.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pngjs from 'pngjs';

const { PNG } = pngjs;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/brand');
const OUT = path.join(SRC, 'test');

const AMBER = [255, 176, 32, 255];
const INK = [10, 10, 11, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

/** Harfler 0–1 kutusunda dikdörtgenlerden: [x0, y0, x1, y1] */
const STROKE_X = 0.3;
const STROKE_Y = 0.22;
const MID = [0.5 - STROKE_Y / 2, 0.5 + STROKE_Y / 2];
const GLYPHS = {
  T: [
    [0, 0, 1, STROKE_Y],
    [0.5 - STROKE_X / 2, 0, 0.5 + STROKE_X / 2, 1],
  ],
  E: [
    [0, 0, STROKE_X, 1],
    [0, 0, 1, STROKE_Y],
    [0, MID[0], 0.85, MID[1]],
    [0, 1 - STROKE_Y, 1, 1],
  ],
  S: [
    [0, 0, 1, STROKE_Y],
    [0, 0, STROKE_X, MID[1]],
    [0, MID[0], 1, MID[1]],
    [1 - STROKE_X, MID[0], 1, 1],
    [0, 1 - STROKE_Y, 1, 1],
  ],
};

const SKEW = Math.tan((10 * Math.PI) / 180); // logodaki D ile aynı eğim
const SAMPLES = 4;

function insideText(px, py, box) {
  const { x, y, letterW, letterH, gap } = box;
  const sx = px - (y + letterH - py) * SKEW;
  const v = (py - y) / letterH;
  if (v < 0 || v > 1) return false;
  let left = x;
  for (const ch of 'TEST') {
    const u = (sx - left) / letterW;
    if (GLYPHS[ch].some(([x0, y0, x1, y1]) => u >= x0 && u <= x1 && v >= y0 && v <= y1)) return true;
    left += letterW + gap;
  }
  return false;
}

function textCoverage(px, py, box) {
  let hits = 0;
  for (let a = 0; a < SAMPLES; a++) {
    for (let b = 0; b < SAMPLES; b++) {
      if (insideText(px + (a + 0.5) / SAMPLES, py + (b + 0.5) / SAMPLES, box)) hits++;
    }
  }
  return hits / SAMPLES ** 2;
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function build({ file, shiftUp, background, bandTop, bandHeight, letterH, letterW, gap, band, text }) {
  const src = PNG.sync.read(readFileSync(path.join(SRC, file)));
  const { width, height } = src;
  const out = new PNG({ width, height });

  const textWidth = 4 * letterW + 3 * gap;
  const box = {
    x: (width - textWidth - letterH * SKEW) / 2, // eğim yazıyı sağa taşırıyor; ortada kalsın
    y: bandTop + (bandHeight - letterH) / 2,
    letterW,
    letterH,
    gap,
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let color;
      if (y >= bandTop && y < bandTop + bandHeight) {
        color = mix(band, text, textCoverage(x, y, box));
      } else if (y + shiftUp < height) {
        const j = ((y + shiftUp) * width + x) * 4;
        color = [...src.data.subarray(j, j + 4)];
      } else {
        color = background;
      }
      out.data.set(color, i);
    }
  }
  writeFileSync(path.join(OUT, file), PNG.sync.write(out));
}

mkdirSync(OUT, { recursive: true });

const ADAPTIVE = { shiftUp: 75, bandTop: 622, bandHeight: 132, letterH: 92, letterW: 74, gap: 16, background: CLEAR };

build({ file: 'adaptive-icon.png', band: AMBER, text: INK, ...ADAPTIVE });
build({ file: 'monochrome-icon.png', band: WHITE, text: CLEAR, ...ADAPTIVE });
build({
  file: 'icon.png',
  shiftUp: 130,
  background: INK,
  bandTop: 640,
  bandHeight: 190,
  letterH: 130,
  letterW: 112,
  gap: 24,
  band: AMBER,
  text: INK,
});
