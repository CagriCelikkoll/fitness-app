import { Pressable, View } from 'react-native';

import { Text } from './Text';

/** Eşit genişlikte sekmeler; seçili olan dolu */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View accessibilityRole="tablist" className="flex-row p-[3px] rounded-2xl bg-bg-surface border border-border">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className={`flex-1 h-10 rounded-xl items-center justify-center active:opacity-70 ${selected ? 'bg-fg' : ''}`}
          >
            <Text className={`text-sm ${selected ? 'text-bg font-bold' : 'text-muted font-semibold'}`} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
