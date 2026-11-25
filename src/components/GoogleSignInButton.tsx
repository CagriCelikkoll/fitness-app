/**
 * "Google ile devam et" (0.13 Bölüm 4). Google'ın marka kurallarına göre:
 * açık temada beyaz, koyu temada koyu dolgu, ince kenarlık, solda dört
 * renkli "G", logo değiştirilmez. Renkler `GOOGLE_BUTTON_COLORS`
 * (`src/theme.ts`, temadan bağımsız).
 */

import { ActivityIndicator, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/ui/Text';
import { useTheme } from '@/hooks/useTheme';
import { GOOGLE_BUTTON_COLORS } from '@/theme';

const LOGO = GOOGLE_BUTTON_COLORS.logo;

function GoogleLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no">
      <Path
        fill={LOGO.red}
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill={LOGO.blue}
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill={LOGO.yellow}
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill={LOGO.green}
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

export function GoogleSignInButton({
  onPress,
  disabled = false,
  loading = false,
}: {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { scheme } = useTheme();
  const tone = GOOGLE_BUTTON_COLORS[scheme];
  const off = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel="Google ile devam et"
      accessibilityState={{ disabled: off, busy: loading }}
      className="min-h-[56px] rounded-[18px] px-5 flex-row items-center justify-center gap-3 active:opacity-80"
      // Google'ın kuralı: devre dışıyken renkler korunur, saydamlaşır
      style={{ backgroundColor: tone.fill, borderColor: tone.stroke, borderWidth: 1, opacity: disabled ? 0.38 : 1 }}
    >
      <View className="w-5 h-5 items-center justify-center">
        {loading ? <ActivityIndicator color={tone.text} size="small" /> : <GoogleLogo size={20} />}
      </View>
      <Text className="text-base font-semibold" style={{ color: tone.text }}>
        Google ile devam et
      </Text>
    </Pressable>
  );
}
