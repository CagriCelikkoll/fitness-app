import { Modal, Pressable, View } from 'react-native';
import { Copy, Pencil, Trash2, type LucideIcon } from 'lucide-react-native';

import { Text } from '@/components/ui/Text';
import { useSheetBottomPadding } from '@/hooks/useSafeBottom';
import { useColors } from '@/hooks/useTheme';
import { nameCase } from '@/lib/typography';

export type RoutineTarget = { id: string; name: string };

/** ⋯ menüsü. Android `Alert` üçten çok düğme göstermiyor, alttan sayfa. */
export function RoutineMenu({
  routine,
  onClose,
  onEdit,
  onCopy,
  onDelete,
}: {
  routine: RoutineTarget | null;
  onClose: () => void;
  onEdit: (routineId: string) => void;
  onCopy: (routine: RoutineTarget) => void;
  onDelete: (routine: RoutineTarget) => void;
}) {
  const COLORS = useColors();
  const sheetPadding = useSheetBottomPadding();

  // Önce sayfa kapanır, işlem sonraki karede: ekran modalın arkasında açılmasın
  const choose = (action: (target: RoutineTarget) => void) => {
    if (!routine) return;
    const target = routine;
    onClose();
    requestAnimationFrame(() => action(target));
  };

  return (
    <Modal visible={routine != null} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Menüyü kapat" />
        <View className="bg-bg rounded-t-3xl border-t border-border px-3 pt-4" style={{ paddingBottom: sheetPadding + 8 }}>
          <Text className="text-fg text-lg font-bold px-3 pb-2" numberOfLines={1}>
            {routine ? nameCase(routine.name) : ''}
          </Text>
          <MenuRow icon={Pencil} label="Düzenle" color={COLORS.text} onPress={() => choose((r) => onEdit(r.id))} />
          <MenuRow icon={Copy} label="Kopyala" color={COLORS.text} onPress={() => choose(onCopy)} />
          <MenuRow icon={Trash2} label="Sil" color={COLORS.danger} danger onPress={() => choose(onDelete)} />
        </View>
      </View>
    </Modal>
  );
}

function MenuRow({
  icon: Icon,
  label,
  color,
  danger = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-3 px-3 h-14 rounded-2xl active:bg-bg-elevated"
    >
      <Icon color={color} size={20} strokeWidth={2} />
      <Text className={`text-base font-semibold ${danger ? 'text-danger' : 'text-fg'}`}>{label}</Text>
    </Pressable>
  );
}
