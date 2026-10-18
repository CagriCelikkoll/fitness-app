import { Text } from 'react-native';

import { programSummary, type GymProgram } from '@/lib/programs';
import { trainerTitle } from '@/lib/trainers';
import { ListRow } from '@/components/ui';

/** Program listesi satırı (v3.6b): ad, yazar, gün / egzersiz sayısı */
export function ProgramRow({
  program,
  divider,
  showAuthor = true,
  extra,
  onPress,
}: {
  program: GymProgram;
  divider?: boolean;
  showAuthor?: boolean;
  /** Alt metne eklenecek (ör. "Salon programı") */
  extra?: string;
  onPress: () => void;
}) {
  const parts = [
    showAuthor && program.authorName ? trainerTitle(program.authorName) : null,
    extra ?? null,
    programSummary(program),
  ].filter(Boolean);
  return (
    <ListRow divider={divider} chevron onPress={onPress}>
      <Text className="text-fg text-base font-semibold" numberOfLines={1}>
        {program.name}
      </Text>
      <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>
        {parts.join(' · ')}
      </Text>
    </ListRow>
  );
}
