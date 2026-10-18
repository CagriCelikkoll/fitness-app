import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import { studentLabel, type TrainerLink } from '@/lib/trainers';
import { ListRow } from '@/components/ui';

/**
 * Öğrencilerim satırı (v3.6a): ad, alt metin, sağda işlem (Bitir / Geri
 * çek). `detail` 3.6c'de devam bilgisi (son geliş, haftalık gün) için.
 */
export function StudentRow({
  link,
  subtitle,
  detail,
  divider,
  actionLabel,
  busy,
  onAction,
}: {
  link: Pick<TrainerLink, 'studentName'>;
  subtitle: string;
  detail?: ReactNode;
  divider?: boolean;
  actionLabel: string;
  busy: boolean;
  onAction: () => void;
}) {
  return (
    <ListRow
      divider={divider}
      right={
        <Pressable
          onPress={onAction}
          disabled={busy}
          accessibilityRole="button"
          hitSlop={8}
          className="px-2 py-1 active:opacity-60"
        >
          <Text className={`text-sm font-semibold ${busy ? 'text-muted' : 'text-danger'}`}>{actionLabel}</Text>
        </Pressable>
      }
    >
      <Text className={`text-base font-semibold ${link.studentName ? 'text-fg' : 'text-muted'}`} numberOfLines={1}>
        {studentLabel(link.studentName)}
      </Text>
      <Text className="text-muted text-xs mt-0.5">{subtitle}</Text>
      {detail}
    </ListRow>
  );
}
