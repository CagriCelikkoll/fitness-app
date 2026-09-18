import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { COLORS } from '@/theme';

interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  icon?: LucideIcon;
  /** İkonu dolgulu çiz (ör. Play) */
  iconFill?: boolean;
  /** İkon yerine yükleniyor göstergesi */
  loading?: boolean;
  className?: string;
}

type Tone = {
  container: string;
  text: string;
  iconColor: string;
};

const BASE =
  'min-h-[52px] rounded-2xl px-5 flex-row items-center justify-center gap-2 active:opacity-80';

const DISABLED: Tone = {
  container: 'bg-bg-elevated',
  text: 'text-muted',
  iconColor: COLORS.muted,
};

function BaseButton({
  label,
  icon: Icon,
  iconFill = false,
  loading = false,
  disabled,
  className = '',
  tone,
  ...rest
}: ButtonProps & { tone: Tone }) {
  const t = disabled || loading ? DISABLED : tone;

  return (
    <Pressable
      disabled={disabled || loading}
      className={`${BASE} ${t.container} ${className}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={t.iconColor} size="small" />
      ) : Icon ? (
        <Icon
          color={t.iconColor}
          size={18}
          fill={iconFill ? t.iconColor : 'none'}
        />
      ) : null}
      <Text className={`text-base font-semibold ${t.text}`}>{label}</Text>
    </Pressable>
  );
}

/** Ekrandaki birincil aksiyon — limon dolgu */
export function PrimaryButton(props: ButtonProps) {
  return (
    <BaseButton
      {...props}
      tone={{
        container: 'bg-accent',
        text: 'text-accent-fg',
        iconColor: COLORS.accentFg,
      }}
    />
  );
}

/** İkincil aksiyon — yükseltilmiş zemin, ince çerçeve */
export function SecondaryButton(props: ButtonProps) {
  return (
    <BaseButton
      {...props}
      tone={{
        container: 'bg-bg-elevated border border-border',
        text: 'text-white',
        iconColor: COLORS.text,
      }}
    />
  );
}

/**
 * Yıkıcı aksiyon. Varsayılan hali soluk (tehlike tonu), `solid` ile dolgulu.
 */
export function DangerButton({
  solid = false,
  ...props
}: ButtonProps & { solid?: boolean }) {
  return (
    <BaseButton
      {...props}
      tone={
        solid
          ? {
              container: 'bg-danger',
              text: 'text-accent-fg',
              iconColor: COLORS.accentFg,
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
