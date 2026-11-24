/**
 * Paylaşmadan önce önizleme (0.13 Bölüm 3): kartın küçük hâli, "Paylaş" /
 * "Vazgeç". Tam sayfa Modal; başka Modal'ın içinden açılmaz (iç içe Modal
 * yok), menüden gelince önce menü kapanır.
 *
 * Görüntü, ekranda görünmeyen tam boy (360 dp) kopyadan alınıyor: küçük
 * önizlemeden büyütülse bulanık olurdu. Kopya, opak ön yüzün arkasında
 * çiziliyor (ekran dışına itilen görünüm bazı cihazlarda çizilmiyor).
 */

import { useRef, useState } from 'react';
import { Alert, Modal, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Share2 } from 'lucide-react-native';

import { ShareCard } from '@/components/ShareCard';
import { PrimaryButton, SecondaryButton } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { useSheetBottomPadding } from '@/hooks/useSafeBottom';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/shareCard';
import { shareCardImage } from '@/lib/shareNative';

/** Görüntü alınan kopyanın genişliği (dp); 3x ekranda tam 1080 px */
const CAPTURE_WIDTH = 360;

/** Önizleme boyutu: ekranın genişliğine ve yüksekliğinin %58'ine sığar */
export function previewWidth(screenWidth: number, screenHeight: number): number {
  const byWidth = screenWidth - 96;
  const byHeight = (screenHeight * 0.58 * SHARE_CARD_WIDTH) / SHARE_CARD_HEIGHT;
  return Math.max(160, Math.floor(Math.min(byWidth, byHeight)));
}

export function SharePreviewSheet({ card, onClose }: { card: ShareCardData | null; onClose: () => void }) {
  const captureRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const bottom = useSheetBottomPadding();
  const { width, height } = useWindowDimensions();

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await shareCardImage(captureRef);
      if (outcome === 'unavailable') {
        Alert.alert('Paylaşılamadı', 'Bu cihazda paylaşım kullanılamıyor.');
        return;
      }
      onClose();
    } catch (err) {
      console.error('[SHARE] Paylaşım görüntüsü hazırlanamadı:', err);
      Alert.alert('Paylaşılamadı', 'Görüntü hazırlanamadı. Tekrar dene.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={card != null} animationType="slide" onRequestClose={onClose}>
      {card != null && (
        <View className="flex-1 bg-bg">
          {/* Görüntü kaynağı: tam boy, ön yüzün arkasında */}
          <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, top: 0 }}>
            <ShareCard ref={captureRef} card={card} width={CAPTURE_WIDTH} />
          </View>

          <View
            className="absolute inset-0 bg-bg items-center justify-between px-6"
            style={{ paddingTop: insets.top + 20, paddingBottom: bottom + 12 }}
          >
            <Text accessibilityRole="header" className="text-fg text-xl font-bold self-start">
              Paylaş
            </Text>
            <View className="rounded-3xl overflow-hidden border border-border">
              <ShareCard card={card} width={previewWidth(width, height)} />
            </View>
            <Text className="text-muted text-xs text-center">
              Kartta adın ya da e-postan yok. Görüntü yalnızca seçtiğin uygulamaya gider.
            </Text>
            <View className="self-stretch gap-2.5">
              <PrimaryButton label="Paylaş" icon={Share2} size="lg" loading={busy} onPress={() => void share()} />
              <SecondaryButton label="Vazgeç" onPress={onClose} disabled={busy} />
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}
