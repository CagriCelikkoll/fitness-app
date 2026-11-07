import { Text } from '@/components/ui/Text';
import { useContextTones } from '@/hooks/useTheme';
import { upperTr } from '@/lib/typography';
import type { ContextKind } from '@/theme';

interface SectionLabelProps {
  children: string;
  /** Bağlam rengi; verilmezse brand (açık temada brandText) */
  color?: ContextKind;
  /** Nötr (ikincil metin rengi) */
  muted?: boolean;
  className?: string;
}

/**
 * Küçük BÜYÜK HARF, harf aralıklı bilgi etiketi (v4.0a 1.4): "SIRADAKİ",
 * "HAREKET 2 / 7 · SET 2 / 4", "DİNLENME". Alan adları ("Ağırlık · kg")
 * bununla yazılmaz.
 */
export function SectionLabel({ children, color, muted = false, className = '' }: SectionLabelProps) {
  const tones = useContextTones(color);
  return (
    <Text
      className={`text-xs font-bold tracking-widest ${muted ? 'text-muted' : ''} ${className}`}
      style={muted ? undefined : { color: tones.ink }}
    >
      {upperTr(children)}
    </Text>
  );
}
