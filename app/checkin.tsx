/**
 * Salona giriş (v3.6c). Salon sekmesi → "Salona giriş" → kamera açılır,
 * girişteki QR afişi okutulur.
 *
 * Afiş telefonun kendi kamerasıyla okutulursa `dinc://checkin?g=…&k=…`
 * bağlantısı uygulamayı bu ekranla açar (parametreler hazır): kamera
 * açılmaz, "Giriş yap" ile onaylanır.
 *
 * Bayrak kapalıyken / giriş yokken / salona üye değilken kamera açılmaz,
 * izin istenmez, istek atılmaz.
 */

import { useCallback, useRef, useState, type ComponentType } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, QrCode } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import { checkInToGym } from '@/hooks/useVisits';
import { checkinParams, parseCheckinQr, qrProblem, qrProblemText } from '@/lib/visits';
import { PrimaryButton, SecondaryButton } from '@/components/ui';

type ScannerComponent = ComponentType<{ paused: boolean; onScan: (data: string) => void }>;

let scanner: ScannerComponent | null | undefined;

/**
 * expo-camera native modülü yalnızca v3.6c ve sonrası derlemelerde var.
 * Eski derlemeye bu kod OTA ile giderse açılışta çökmesin diye modül
 * ekran açılınca yükleniyor; yoksa null.
 */
function loadScanner(): ScannerComponent | null {
  if (scanner !== undefined) return scanner;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    scanner = (require('@/components/QrScanner') as { QrScanner: ScannerComponent }).QrScanner;
  } catch (e) {
    console.warn('[CHECKIN] Kamera modülü yok:', e);
    scanner = null;
  }
  return scanner;
}

type Phase =
  | { kind: 'scan' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; gymName: string; reused: boolean };

export default function CheckinScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ g?: string; k?: string }>();
  const { available, userId, memberships } = useGymMembership();
  const [phase, setPhase] = useState<Phase>({ kind: 'scan' });
  const handling = useRef(false);

  const linked = checkinParams(params.g, params.k);
  const memberGymIds = memberships.map((m) => m.gymId);

  const submit = useCallback(
    async (parsed: { gymId: string; secret: string } | null) => {
      if (handling.current || !userId) return;
      handling.current = true;
      const problem = qrProblem(parsed, memberGymIds);
      if (problem || !parsed) {
        setPhase({ kind: 'error', message: qrProblemText(problem ?? 'not_ours') });
        return;
      }
      setPhase({ kind: 'busy' });
      const result = await checkInToGym(userId, parsed.gymId, parsed.secret);
      if (!result.ok) {
        setPhase({ kind: 'error', message: result.error.message });
        return;
      }
      const gym = memberships.find((m) => m.gymId === parsed.gymId);
      setPhase({ kind: 'done', gymName: gym?.gymName ?? 'Salon', reused: result.reused });
    },
    [userId, memberGymIds, memberships]
  );

  const retry = () => {
    handling.current = false;
    setPhase({ kind: 'scan' });
  };

  const title = <Stack.Screen options={{ title: 'Salona giriş' }} />;

  if (!available || !userId || memberships.length === 0) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        {title}
        <Text className="text-muted text-base text-center">Salon girişi için bir salona üye olman gerekiyor.</Text>
      </View>
    );
  }

  if (phase.kind === 'done') {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        {title}
        <CircleCheck color={COLORS.success} size={56} strokeWidth={1.5} />
        <Text className="text-fg text-2xl font-bold text-center">{phase.reused ? 'Zaten içeridesin' : 'Hoş geldin!'}</Text>
        <Text className="text-muted text-base text-center leading-6">
          {phase.reused
            ? `${phase.gymName} girişin daha önce kaydedilmişti.`
            : `${phase.gymName} girişin kaydedildi. Antrenmanı bitirince çıkışın otomatik yazılır.`}
        </Text>
        <PrimaryButton label="Tamam" onPress={() => router.back()} />
      </View>
    );
  }

  if (phase.kind === 'busy') {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        {title}
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  if (phase.kind === 'error') {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        {title}
        <QrCode color={COLORS.danger} size={48} strokeWidth={1.5} />
        <Text className="text-fg text-lg font-semibold text-center">{phase.message}</Text>
        {!linked && <PrimaryButton label="Tekrar okut" onPress={retry} />}
        <SecondaryButton label="Kapat" onPress={() => router.back()} />
      </View>
    );
  }

  // Telefonun kamerasıyla okutulan afişten gelindi: tek dokunuşla giriş
  if (linked) {
    const gym = memberships.find((m) => m.gymId === linked.gymId);
    return (
      <View className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        {title}
        <QrCode color={COLORS.accent} size={48} strokeWidth={1.5} />
        <Text className="text-fg text-lg font-semibold text-center">
          {gym ? `${gym.gymName} salonuna giriş yapılsın mı?` : 'Salona giriş yapılsın mı?'}
        </Text>
        <PrimaryButton label="Giriş yap" onPress={() => void submit(linked)} />
        <SecondaryButton label="Vazgeç" onPress={() => router.back()} />
      </View>
    );
  }

  const Scanner = loadScanner();
  if (!Scanner) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        {title}
        <Text className="text-muted text-base text-center leading-6">
          QR okutmak için uygulamanın yeni sürümü gerekiyor. Şimdilik afişi telefonunun kamerasıyla okutabilirsin.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {title}
      <Scanner paused={handling.current} onScan={(data) => void submit(parseCheckinQr(data))} />
      <View className="absolute left-5 right-5 bottom-8 bg-bg-surface/90 rounded-2xl px-4 py-3">
        <Text className="text-fg text-sm text-center">Salon girişindeki QR kodu çerçeveye getir.</Text>
      </View>
    </View>
  );
}
