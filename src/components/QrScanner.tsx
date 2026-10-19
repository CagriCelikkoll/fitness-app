import { useEffect, useRef } from 'react';
import { Linking, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera } from 'lucide-react-native';

import { useColors } from '@/hooks/useTheme';
import { PrimaryButton } from '@/components/ui';

/**
 * QR okuyucu (v3.6c, salon girişi). Yalnızca "Salona giriş" ekranında
 * mount edilir: izin o an istenir, kamera o an açılır. Görüntü kaydedilmez,
 * hiçbir yere gönderilmez; yalnızca okunan QR metni `onScan`'e gider.
 *
 * Bu dosya expo-camera'yı içe aktarıyor; native modül olmayan eski
 * derlemede ekran bunu `require` ile, hata yakalayarak yüklüyor.
 */
export function QrScanner({ paused, onScan }: { paused: boolean; onScan: (data: string) => void }) {
  const COLORS = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const asked = useRef(false);

  // Ekran açılınca bir kez sor (kullanıcı "Salona giriş"e bastı)
  useEffect(() => {
    if (!permission || permission.granted || asked.current || !permission.canAskAgain) return;
    asked.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  if (!permission) return <View className="flex-1 bg-bg" />;

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        <Camera color={COLORS.muted} size={40} strokeWidth={1.5} />
        <Text className="text-fg text-lg font-semibold text-center">Kamera izni gerekiyor</Text>
        <Text className="text-muted text-sm text-center leading-5">
          Salon girişindeki QR kodu okumak için kamerayı kullanıyoruz. Görüntü kaydedilmez, hiçbir yere gönderilmez.
        </Text>
        {permission.canAskAgain ? (
          <PrimaryButton label="İzin ver" onPress={() => void requestPermission()} />
        ) : (
          <PrimaryButton label="Ayarları aç" onPress={() => void Linking.openSettings()} />
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={paused ? undefined : (r) => onScan(r.data)}
      />
      {/* Hedef çerçevesi */}
      <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        <View className="w-64 h-64 rounded-3xl border-4 border-accent" />
      </View>
    </View>
  );
}

