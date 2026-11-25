/**
 * "Apple ile devam et" (0.13 Bölüm 5, yalnızca iOS). Apple'ın kendi
 * düğmesi (`AppleAuthenticationButton`): metni, logosu ve dili sistemden,
 * marka kurallarına kendiliğinden uyar. Rengi ve köşesi yalnızca düğmenin
 * kendi seçenekleriyle değişir: koyu temada beyaz, açık temada siyah.
 *
 * Devre dışı ve sürerken: Google düğmesindeki gibi saydamlaşır, dokunuş
 * alınmaz (native düğmenin devre dışı hâli yok).
 */

import { View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { loadAppleAuthentication } from '@/lib/appleSignInNative';

const HEIGHT = 56;
const RADIUS = 18;

export function AppleSignInButton({
  onPress,
  disabled = false,
  loading = false,
}: {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { scheme } = useTheme();
  const mod = loadAppleAuthentication();
  if (!mod) return null;
  const { AppleAuthenticationButton, AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } = mod;
  const off = disabled || loading;

  return (
    <View
      pointerEvents={off ? 'none' : 'auto'}
      accessibilityState={{ disabled: off, busy: loading }}
      style={{ opacity: disabled ? 0.38 : loading ? 0.6 : 1 }}
    >
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={
          scheme === 'dark' ? AppleAuthenticationButtonStyle.WHITE : AppleAuthenticationButtonStyle.BLACK
        }
        cornerRadius={RADIUS}
        style={{ height: HEIGHT, width: '100%' }}
        onPress={onPress}
      />
    </View>
  );
}
