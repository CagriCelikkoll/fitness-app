import { ChipGroup } from '@/components/ChipGroup';
import { MAX_WEEKLY_GOAL, MIN_WEEKLY_GOAL } from '@/lib/weeklyGoal';

const NO_GOAL = 'none';

const OPTIONS: { value: string; label: string }[] = [
  ...Array.from({ length: MAX_WEEKLY_GOAL - MIN_WEEKLY_GOAL + 1 }, (_, i) => {
    const days = String(MIN_WEEKLY_GOAL + i);
    return { value: days, label: days };
  }),
  { value: NO_GOAL, label: 'Hedef yok' },
];

/** Haftalık hedef seçimi: 1-7 gün ya da "Hedef yok" (Ayarlar, ana sayfa) */
export function WeeklyGoalPicker({
  value,
  onChange,
  label = 'Haftalık hedef (gün)',
}: {
  value: number | null;
  onChange: (days: number | null) => void;
  label?: string;
}) {
  return (
    <ChipGroup
      label={label}
      options={OPTIONS}
      value={value == null ? NO_GOAL : String(value)}
      onChange={(v) => onChange(v === NO_GOAL ? null : Number(v))}
    />
  );
}
