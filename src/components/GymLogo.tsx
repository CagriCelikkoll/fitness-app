import { useState } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';

import { gymInitial } from '@/lib/gymLogo';
import { useColors, useGymTones } from '@/hooks/useTheme';

/**
 * Salon logosu (v3.3), yuvarlak. Logo yoksa ya da yüklenemezse salon
 * adının baş harfi, salon renginin temadaki dolgu tonunda (v3.5). Önbellek: bellek + disk (adres her
 * yüklemede değişiyor, eski logo kalmaz).
 */
export function GymLogo({
  name,
  logoUrl,
  gymColor,
  size,
}: {
  name: string;
  logoUrl: string | null | undefined;
  /** Salonun kayıtlı rengi; listede yoksa uygulama vurgusu */
  gymColor: string | null | undefined;
  size: number;
}) {
  const COLORS = useColors();
  const tones = useGymTones(gymColor);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { width: size, height: size, borderRadius: size / 2 };

  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <Image
        source={{ uri: logoUrl }}
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={150}
        style={[style, { backgroundColor: COLORS.elevated }]}
        onError={() => setFailedUrl(logoUrl)}
        accessibilityLabel={`${name} logosu`}
      />
    );
  }
  return (
    <View style={[style, { backgroundColor: tones.fill }]} className="items-center justify-center">
      <Text style={{ color: tones.onFill, fontSize: Math.round(size * 0.5), lineHeight: Math.round(size * 0.62) }} className="font-bold">
        {gymInitial(name)}
      </Text>
    </View>
  );
}
