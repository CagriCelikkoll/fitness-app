import { toQR } from 'toqr';

/**
 * QR kodu → SVG yolu (v3.6c, salon girişi afişi). Kodlayıcı `toqr`
 * (saf JS, MIT); çizim `react-native-svg` ile, yeni native paket yok.
 * React bilmez; test/visits.test.ts.
 */

export interface QrMatrix {
  /** Kenar uzunluğu (modül) */
  size: number;
  /** Satır satır, true = koyu modül */
  dark: (x: number, y: number) => boolean;
}

export function qrMatrix(content: string): QrMatrix {
  const cells = toQR(content);
  const size = Math.round(Math.sqrt(cells.length));
  return { size, dark: (x, y) => cells[y * size + x] === 1 };
}

/**
 * Koyu modüllerin tek bir SVG yolu (yatay şeritler birleşik), kenarda
 * `quiet` modül boşlukla. viewBox: 0 0 (size + 2·quiet).
 */
export function qrPath(matrix: QrMatrix, quiet = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y++) {
    let x = 0;
    while (x < matrix.size) {
      if (!matrix.dark(x, y)) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < matrix.size && matrix.dark(x, y)) x += 1;
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`);
    }
  }
  return parts.join('');
}
