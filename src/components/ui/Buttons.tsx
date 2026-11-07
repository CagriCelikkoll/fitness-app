import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Text } from '@/components/ui/Text';
import { useColors, useContextTones } from '@/hooks/useTheme';
import type { ContextKind } from '@/theme';

interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  icon?: LucideIcon;
  /** İkonu dolgulu çiz (ör. Play) */
  iconFill?: boolean;
  /** İkon yerine yükleniyor göstergesi */
  loading?: boolean;
  /** `lg`: 64 yüksek (odak modu "Seti tamamla"); varsayılan 56 */
  size?: 'md' | 'lg';
  className?: string;
}

type Tone = {
  container: string;
  text: string;
  iconColor: string;
  /** Dinamik dolgu (bağlam rengi) */
  backgroundColor?: string;
  textColor?: string;
};

// v4.0a 1.5: yükseklik 56–64, radius 18
const BASE = 'rounded-[18px] px-5 flex-row items-center justify-center gap-2 active:opacity-80';
const HEIGHT = { md: 'min-h-[56px]', lg: 'min-h-[64px]' } as const;

function BaseButton({
  label,
  icon: Icon,
  iconFill = false,
  loading = false,
  disabled,
  size = 'md',
  className = '',
  tone,
  style,
  ...rest
}: ButtonProps & { tone: Tone }) {
  const COLORS = useColors();
  const off = disabled || loading;
  const t: Tone = off ? { container: 'bg-bg-elevated', text: 'text-muted', iconColor: COLORS.muted } : tone;
  const dynamic = !off && t.backgroundColor ? { backgroundColor: t.backgroundColor } : null;

  return (
    <Pressable
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: loading }}
      className={`${BASE} ${HEIGHT[size]} ${t.container} ${className}`}
      style={typeof style === 'function' ? style : [dynamic, style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={t.iconColor} size="small" />
      ) : Icon ? (
        <Icon color={t.iconColor} size={size === 'lg' ? 20 : 18} fill={iconFill ? t.iconColor : 'none'} />
      ) : null}
      <Text
        className={`${size === 'lg' ? 'text-lg' : 'text-base'} font-bold ${t.text}`}
        style={!off && t.textColor ? { color: t.textColor } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Ekrandaki birincil aksiyon. Varsayılan brand dolgusu (neon ya da salon
 * rengi); `color` verilirse o bağlam renginde (yazı koyu).
 */
export function PrimaryButton({ color, ...props }: ButtonProps & { color?: ContextKind }) {
  const COLORS = useColors();
  const ctx = useContextTones(color);
  return (
    <BaseButton
      {...props}
      tone={
        color
          ? { container: '', text: '', iconColor: ctx.onFill, backgroundColor: ctx.fill, textColor: ctx.onFill }
          : { container: 'bg-accent', text: 'text-accent-fg', iconColor: COLORS.accentFg }
      }
    />
  );
}

/** İkincil aksiyon — kenarlıklı, nötr */
export function SecondaryButton(props: ButtonProps) {
  const COLORS = useColors();
  return (
    <BaseButton
      {...props}
      tone={{
        container: 'bg-bg-elevated border border-border',
        text: 'text-fg',
        iconColor: COLORS.text,
      }}
    />
  );
}

/**
 * Yıkıcı aksiyon. Varsayılan hali soluk (tehlike tonu), `solid` ile dolgulu.
 */
export function DangerButton({ solid = false, ...props }: ButtonProps & { solid?: boolean }) {
  const COLORS = useColors();
  return (
    <BaseButton
      {...props}
      tone={
        solid
          ? {
              container: 'bg-danger',
              text: 'text-danger-fg',
              iconColor: COLORS.dangerFg,
            }
          : {
              container: 'bg-danger/10 border border-danger/40',
              text: 'text-danger',
              iconColor: COLORS.danger,
            }
      }
    />
  );
}
