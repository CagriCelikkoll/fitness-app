import { Text, View } from 'react-native';

import { PALETTES, gymAccentTones, type ColorScheme } from '@/theme';

const SCHEMES: { scheme: ColorScheme; label: string }[] = [
  { scheme: 'light', label: 'Açık tema' },
  { scheme: 'dark', label: 'Koyu tema' },
];

/**
 * Salon rengi seçilirken iki temada nasıl görüneceği (v3.5): yan yana iki
 * küçük kart, her biri kendi temasının renkleriyle (o anki temadan
 * bağımsız). Dolgu düğmesi ve zemin üstünde vurgu metni.
 */
export function GymColorPreview({ hex }: { hex: string }) {
  return (
    <View className="flex-row gap-3">
      {SCHEMES.map(({ scheme, label }) => {
        const p = PALETTES[scheme];
        const tones = gymAccentTones(hex, scheme);
        return (
          <View
            key={scheme}
            className="flex-1 rounded-2xl p-3 gap-2 border"
            style={{ backgroundColor: p.surface, borderColor: p.border }}
            accessibilityLabel={`${label} önizlemesi`}
          >
            <Text className="text-xs" style={{ color: p.muted }}>
              {label}
            </Text>
            <View className="rounded-xl py-2 items-center" style={{ backgroundColor: tones.fill }}>
              <Text className="text-sm font-semibold" style={{ color: tones.onFill }}>
                Başla
              </Text>
            </View>
            <Text className="text-sm font-semibold" style={{ color: tones.ink }}>
              Bağlantı →
            </Text>
          </View>
        );
      })}
    </View>
  );
}
