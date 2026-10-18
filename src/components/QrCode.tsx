import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

import { qrMatrix, qrPath } from '@/lib/qr';
import { QR_COLORS } from '@/theme';

/** QR kodu (v3.6c): temadan bağımsız beyaz zemin üstünde siyah, kenar boşluklu */
export function QrCode({ value, size }: { value: string; size: number }) {
  const { path, box } = useMemo(() => {
    const matrix = qrMatrix(value);
    return { path: qrPath(matrix, 4), box: matrix.size + 8 };
  }, [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} accessibilityLabel="Salon girişi QR kodu">
      <Rect x={0} y={0} width={box} height={box} fill={QR_COLORS.light} />
      <Path d={path} fill={QR_COLORS.dark} />
    </Svg>
  );
}
