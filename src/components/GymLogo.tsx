import { useState } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';

import { gymInitial } from '@/lib/gymLogo';
import { COLORS } from '@/theme';

/**
 * Salon logosu (v3.3), yuvarlak. Logo yoksa ya da yüklenemezse salon
 * adının baş harfi, salon renginde. Önbellek: bellek + disk (adres her
 * yüklemede değişiyor, eski logo kalmaz).
 */
export function GymLogo({
  name,
  logoUrl,
  color,
  size,
}: {
  name: string;
  logoUrl: string | null | undefined;
  color: string;
  size: number;
}) {
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
    <View style={[style, { backgroundColor: color }]} className="items-center justify-center">
      <Text style={{ color: COLORS.accentFg, fontSize: Math.round(size * 0.5), lineHeight: Math.round(size * 0.62) }} className="font-bold">
        {gymInitial(name)}
      </Text>
    </View>
  );
}
