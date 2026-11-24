import { Modal, Pressable, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Text } from '@/components/ui/Text';
import { useSheetBottomPadding } from '@/hooks/useSafeBottom';
import { useColors } from '@/hooks/useTheme';

export interface ActionMenuItem {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onPress: () => void;
}

/**
 * Alttan açılan ⋯ menüsü (antrenman ayrıntısı; 0.13). Android `Alert` üçten
 * çok düğme göstermiyor. Seçimde önce menü kapanır, işlem sonraki karede:
 * ardından açılan Modal (paylaşım önizlemesi) iç içe olmaz.
 */
export function ActionMenu({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: readonly ActionMenuItem[];
  onClose: () => void;
}) {
  const COLORS = useColors();
  const sheetPadding = useSheetBottomPadding();

  const choose = (action: () => void) => {
    onClose();
    requestAnimationFrame(action);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Menüyü kapat" />
        <View className="bg-bg rounded-t-3xl border-t border-border px-3 pt-4" style={{ paddingBottom: sheetPadding + 8 }}>
          <Text className="text-fg text-lg font-bold px-3 pb-2" numberOfLines={1}>
            {title}
          </Text>
          {items.map(({ icon: Icon, label, danger = false, onPress }) => (
            <Pressable
              key={label}
              onPress={() => choose(onPress)}
              accessibilityRole="button"
              className="flex-row items-center gap-3 px-3 h-14 rounded-2xl active:bg-bg-elevated"
            >
              <Icon color={danger ? COLORS.danger : COLORS.text} size={20} strokeWidth={2} />
              <Text className={`text-base font-semibold ${danger ? 'text-danger' : 'text-fg'}`}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}
