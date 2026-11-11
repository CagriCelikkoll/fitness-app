import { Text } from '@/components/ui/Text';
import { upperTr } from '@/lib/typography';

interface ScreenTitleProps {
  children: string;
  className?: string;
}

/** Ekran başlığı (v4.0a 1.4): geniş, 32, Türkçe BÜYÜK HARF */
export function ScreenTitle({ children, className = '' }: ScreenTitleProps) {
  return (
    <Text accessibilityRole="header" className={`font-display text-fg text-[32px] leading-[38px] ${className}`}>
      {upperTr(children)}
    </Text>
  );
}
