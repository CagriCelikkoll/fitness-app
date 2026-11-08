import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import type { Tabs } from 'expo-router';

import { Text } from '@/components/ui/Text';
import { useFloatingTabBarLayout } from '@/hooks/useSafeBottom';
import { useColors } from '@/hooks/useTheme';
import { withAlpha } from '@/lib/color';
import { TAB_BAR } from '@/lib/safeArea';
import { FONT_FAMILIES } from '@/lib/typography';

/** expo-router kendi bottom-tabs kopyasını kullanıyor; tipler oradan */
export type FloatingTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * Havada duran alt menü (v4.0a Bölüm 5): kenarlardan 16, alttan gezinme
 * çubuğu + 22, yükseklik 64, radius 22, zemin `surface` %94, 1 px `line`.
 * Etiket 12 px; aktif sekme ikon + yazı `brand` mürekkebi (sekmenin kendi
 * `tabBarActiveTintColor`'ı varsa o: Salon sekmesi salon renginde).
 * `href: null` ile gizlenen sekmeler (`tabBarItemStyle.display: 'none'`)
 * çizilmez. Klavye açıkken menü gizli.
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const COLORS = useColors();
  const { bottom, keyboardVisible } = useFloatingTabBarLayout();
  if (keyboardVisible) return null;

  const visible = state.routes.filter((route) => {
    const style = descriptors[route.key]?.options.tabBarItemStyle as { display?: string } | undefined;
    return style?.display !== 'none';
  });
  const labels = visible.map((r) => String(descriptors[r.key]?.options.title ?? r.name));

  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: 'absolute',
        left: TAB_BAR.side,
        right: TAB_BAR.side,
        bottom,
        height: TAB_BAR.height,
        borderRadius: TAB_BAR.radius,
        backgroundColor: withAlpha(COLORS.surface, 0.94),
        borderWidth: 1,
        borderColor: COLORS.border,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {visible.map((route, i) => {
        const { options } = descriptors[route.key]!;
        const focused = state.routes[state.index]?.key === route.key;
        const color = focused ? (options.tabBarActiveTintColor ?? COLORS.accent) : COLORS.muted;
        const label = labels[i]!;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            className="flex-1 h-full items-center justify-center active:opacity-70"
          >
            {options.tabBarIcon?.({ focused, color, size: 22 })}
            <Text
              numberOfLines={1}
              // Sığmazsa (6 sekme, dar ekran) yalnızca gerektiği kadar küçülür
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={{
                color,
                fontSize: 12,
                marginTop: 3,
                fontFamily: focused ? FONT_FAMILIES.bold : FONT_FAMILIES.semibold,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
