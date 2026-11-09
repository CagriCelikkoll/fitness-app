/**
 * İlk açılış (karşılama) akışı: beş kısa adım.
 *
 * 1. Tanıtım — görselli üç sayfa (`OnboardingIntro`, v4.0b)
 * 2. Gizlilik — yasal metin bağlantıları ve vücut ölçüsü açık rızası
 *    (kutu boş gelir; işaretsiz "Devam" declined yazar, akış sürer)
 * 3. Profil — boy/doğum tarihi/cinsiyet (Ayarlar'daki formun aynısı)
 * 4. Program — önce hedef (hızlı gelişim / formu koru), sonra haftalık gün
 *    sayısı (2–6); `ProgramRecommender` (v3.8, Hazır Programlar'daki
 *    "Bana program öner" ile aynı)
 * 5. İpuçları — ✓ ile onaylama ve yedek alma
 *
 * Tek ekran, adım durumu içeride: adımlar seçilen programı paylaşıyor ve
 * ayrı ayrı derin bağlantıya ihtiyaçları yok.
 *
 * Kime gösterileceğine ana sayfa karar veriyor (`app/(tabs)/index.tsx`);
 * Ayarlar → Hakkında'dan da açılabiliyor. "Atla" ya da "Başla" bayrağı
 * set edip Antrenman sekmesine gider. İlk adımdaki "Geri yükle"
 * Ayarlar'daki yedek akışını açar, "Hesabım var, giriş yap" giriş ekranını;
 * ikisi de başarılıysa bayrak set edilip ana sayfaya gidilir.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import Storage from 'expo-sqlite/kv-store';
import { Check, ChevronLeft, Upload } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useBackupRestore } from '@/hooks/useBackupRestore';
import { useSession } from '@/hooks/useSession';
import { appSettings, type AppSettings } from '@/db/schema';
import { markOnboardingDone } from '@/lib/onboarding';
import { OnboardingIntro, ProgressDots } from '@/components/OnboardingIntro';
import { ProgramRecommender, useProgramRecommender } from '@/components/ProgramRecommender';
import { ProfileFields, useProfileForm } from '@/components/ProfileForm';
import { ConsentCard } from '@/components/ConsentCard';
import { setHealthConsent } from '@/hooks/useHealthConsent';
import { useColors } from '@/hooks/useTheme';
import { Card, IconButton, PrimaryButton, ScreenTitle } from '@/components/ui';

const STEP_COUNT = 5;
/** Tanıtımın kendi sayfa göstergesi var; noktalar sonraki adımları sayar */
const FORM_STEP_COUNT = STEP_COUNT - 1;

export default function OnboardingScreen() {
  const COLORS = useColors();
  const db = useDb();
  const router = useRouter();

  const { data: settingsRows, updatedAt } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1)
  );

  const [step, setStep] = useState(0);
  const [introPage, setIntroPage] = useState(0);
  // Adımlar arasında gezinince seçimler kalsın diye durum burada
  const recommender = useProgramRecommender();
  const [finishing, setFinishing] = useState(false);

  const next = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Android geri tuşu bir önceki adıma / tanıtım sayfasına döner ("Geri"
  // ile aynı). İlk sayfada dinleyici yok: varsayılan davranış (çıkış /
  // Ayarlar'a dönüş) kalır. Ekrandan çıkınca ya da adım değişince temizlenir.
  useEffect(() => {
    if (step === 0 && introPage === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 0) setIntroPage((p) => Math.max(p - 1, 0));
      else setStep((s) => Math.max(s - 1, 0));
      return true;
    });
    return () => sub.remove();
  }, [step, introPage]);

  /** Atla ve Başla: bayrak set edilir, Antrenman sekmesine gidilir */
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await markOnboardingDone(Storage);
    } catch (err) {
      // Bayrak yazılamazsa karşılama bir dahaki açılışta yeniden çıkar;
      // kullanıcıyı burada bekletmenin anlamı yok.
      console.error('[ONBOARDING] Bayrak yazılamadı:', err);
    }
    // Ayarlar'dan açıldıysa sekmelere geri döner, ilk açılışta (sekmeler
    // yığında yok) bu ekranın yerine geçer.
    router.dismissTo('/workout');
  };

  const finishToHome = useCallback(async () => {
    try {
      await markOnboardingDone(Storage);
    } catch (err) {
      console.error('[ONBOARDING] Bayrak yazılamadı:', err);
    }
    router.dismissTo('/');
  }, [router]);

  // Eski uygulamadan yedekle geçen kullanıcı karşılamayı atlayıp verisine
  // ulaşsın. Akış Ayarlar'dakiyle aynı; başarılıysa bayrak set edilip ana
  // sayfaya gidilir.
  const { importing, startRestore } = useBackupRestore(finishToHome);

  // Hesabı olan kullanıcı girişten sonra verisine ulaşsın. Yalnızca buradan
  // açılan girişte: kayıtlı oturum açılışta sonradan gelirse akış kesilmesin.
  // Geçiş bittikten sonra (odaklanınca), giriş ekranının `back`'iyle çakışmaz.
  const { available: accountAvailable, userId } = useSession();
  const signInOpened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!signInOpened.current || !userId) return;
      signInOpened.current = false;
      void finishToHome();
    }, [userId, finishToHome])
  );
  const openSignIn = () => {
    signInOpened.current = true;
    router.push('/account/sign-in');
  };

  // v2.2: vücut ölçüsü rızası. Kutu boş gelir; geri dönülünce son seçim
  // korunur. "Devam": işaretliyse granted, değilse declined; ikisinde de
  // akış sürer (karşılamada ölçü soran adım yok, atlanan bir şey yok).
  // Yazılamazsa durum "sorulmadı" kalır, ilk ölçü girişinde yine sorulur.
  const [consentChecked, setConsentChecked] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const saveConsentAndNext = async () => {
    setSavingConsent(true);
    try {
      await setHealthConsent(consentChecked ? 'granted' : 'declined');
    } catch (err) {
      console.error('[ONBOARDING] Rıza kaydedilemedi:', err);
    } finally {
      setSavingConsent(false);
    }
    next();
  };

  const layout = { step, onSkip: finish, onBack: back, skipDisabled: finishing };

  if (step === 0) {
    return (
      <OnboardingIntro
        page={introPage}
        onPageChange={setIntroPage}
        onDone={next}
        onSkip={() => void finish()}
        skipDisabled={finishing}
        importing={importing}
        onRestore={() => void startRestore()}
        onSignIn={accountAvailable && !userId ? openSignIn : null}
      />
    );
  }

  if (step === 1) {
    return (
      <StepLayout
        {...layout}
        footer={
          <PrimaryButton
            label="Devam"
            loading={savingConsent}
            onPress={() => void saveConsentAndNext()}
          />
        }
      >
        <PrivacyStep checked={consentChecked} onCheckedChange={setConsentChecked} />
      </StepLayout>
    );
  }

  if (step === 2) {
    // Form durumu kayıtlı ayarlardan kuruluyor; ayarlar gelmeden kurulmasın
    if (!updatedAt) {
      return (
        <StepLayout {...layout} footer={null}>
          <View className="pt-10">
            <ActivityIndicator color={COLORS.accent} />
          </View>
        </StepLayout>
      );
    }
    return (
      <ProfileStep
        key={settingsRows?.[0]?.id ?? 'new'}
        layout={layout}
        settings={settingsRows?.[0]}
        onNext={next}
      />
    );
  }

  if (step === 3) {
    return (
      <StepLayout
        {...layout}
        footer={<PrimaryButton label="Devam" onPress={next} />}
      >
        <ProgramRecommender {...recommender} />
      </StepLayout>
    );
  }

  return (
    <StepLayout
      {...layout}
      footer={
        <PrimaryButton
          label="Başla"
          loading={finishing}
          onPress={() => void finish()}
        />
      }
    >
      <TipsStep />
    </StepLayout>
  );
}

// ============================================================================
// Ortak iskelet: üstte Geri / Atla, ortada içerik, altta noktalar + düğme
// ============================================================================

interface StepLayoutProps {
  step: number;
  onSkip: () => void;
  onBack: () => void;
  skipDisabled: boolean;
  footer: React.ReactNode;
  children: React.ReactNode;
}

function StepLayout({
  step,
  onSkip,
  onBack,
  skipDisabled,
  footer,
  children,
}: StepLayoutProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 h-14">
        <IconButton icon={ChevronLeft} accessibilityLabel="Geri" onPress={onBack} />
        <Pressable
          onPress={onSkip}
          disabled={skipDisabled}
          accessibilityRole="button"
          hitSlop={8}
          className="h-11 px-3.5 justify-center active:opacity-60"
        >
          <Text className="text-muted text-sm font-bold">Atla</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-2 pb-6 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>

      <View className="px-5 pt-3 pb-4 gap-4 bg-bg">
        <ProgressDots
          index={step - 1}
          count={FORM_STEP_COUNT}
          label={`Adım ${step} / ${FORM_STEP_COUNT}`}
          className="justify-center"
        />
        {footer}
      </View>
    </View>
  );
}

function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="mb-2">
      <ScreenTitle>{title}</ScreenTitle>
      {subtitle != null && (
        <Text className="text-muted text-sm leading-5 mt-2">{subtitle}</Text>
      )}
    </View>
  );
}

// ============================================================================
// 2) Gizlilik ve vücut ölçüsü rızası
// ============================================================================

function PrivacyStep({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const router = useRouter();
  const openDoc = (doc: 'privacy' | 'kvkk') =>
    router.push({ pathname: '/legal/[doc]', params: { doc } });

  return (
    <>
      <StepTitle
        title="Gizlilik"
        subtitle="Verilerin önce bu telefonda durur; hesap açmazsan hiçbir yere gönderilmez."
      />
      <View className="flex-row flex-wrap gap-x-5 gap-y-2">
        <Pressable onPress={() => openDoc('privacy')} hitSlop={6} className="active:opacity-60">
          <Text className="text-accent text-sm font-semibold">Gizlilik Politikası →</Text>
        </Pressable>
        <Pressable onPress={() => openDoc('kvkk')} hitSlop={6} className="active:opacity-60">
          <Text className="text-accent text-sm font-semibold">Aydınlatma Metni →</Text>
        </Pressable>
      </View>
      <ConsentCard
        checked={checked}
        onCheckedChange={onCheckedChange}
        showNoticeLink={false}
      />
      <Text className="text-muted text-xs leading-5">
        Onaylamazsan da uygulamanın geri kalanını kullanabilirsin; kilo ve
        vücut ölçüsü takibi kapalı kalır.
      </Text>
    </>
  );
}

// ============================================================================
// 3) Profil
// ============================================================================

function ProfileStep({
  layout,
  settings,
  onNext,
}: {
  layout: Omit<StepLayoutProps, 'footer' | 'children'>;
  settings?: AppSettings;
  onNext: () => void;
}) {
  const form = useProfileForm(settings);

  // Boş form da kaydedilir (alanlar null kalır); geçersiz girişte
  // hata gösterilir ve adım ilerlemez — "Atla" yine çalışır.
  const handleNext = async () => {
    if (await form.save()) onNext();
  };

  return (
    <StepLayout
      {...layout}
      footer={
        <PrimaryButton
          label="Devam"
          loading={form.saving}
          onPress={() => void handleNext()}
        />
      }
    >
      <StepTitle
        title="Profil"
        subtitle="Vücut kitle indeksi ve bazal metabolizma hesapları için. İstersen sonra Profil'den de girebilirsin."
      />
      <Card className="gap-4">
        <ProfileFields form={form} />
      </Card>
    </StepLayout>
  );
}

// ============================================================================
// 5) Bilmen gereken iki şey
// ============================================================================

function TipsStep() {
  const COLORS = useColors();
  return (
    <>
      <StepTitle title="Bilmen gereken iki şey" />

      <Card className="gap-3">
        <Text className="text-fg text-lg font-semibold">✓ ile onayla</Text>
        <Text className="text-muted text-sm leading-5">
          Setin değerlerini girdikten sonra sağdaki ✓'ye bas. Onaylanmayan
          setler antrenman bitince sorulur.
        </Text>
        <SetRowMock />
      </Card>

      <Card className="gap-3">
        <View className="flex-row items-center gap-2">
          <Upload color={COLORS.text} size={18} />
          <Text className="text-fg text-lg font-semibold">Yedek al</Text>
        </View>
        <Text className="text-muted text-sm leading-5">
          Verilerin önce bu telefonda durur; hesap açmazsan hiçbir yere
          gönderilmez. Telefon değiştirirsen ya da uygulamayı silersen
          kaybolmasın diye ara sıra Profil'den yedek al.
        </Text>
      </Card>
    </>
  );
}

/**
 * Antrenman ekranındaki set satırının statik taklidi: değerler girilmiş,
 * ✓ henüz basılmamış ve vurgulu. Gerçek bileşen değil, dokunulmaz.
 */
function SetRowMock() {
  const COLORS = useColors();
  return (
    <View
      className="flex-row items-center px-2 py-2 rounded-2xl bg-bg-elevated/50"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text className="text-fg text-lg font-semibold tabular-nums w-7">1</Text>
      <Text className="flex-1 text-muted text-sm tabular-nums text-center">
        60 × 8
      </Text>
      <View className="w-16 h-11 rounded-xl bg-bg-elevated items-center justify-center">
        <Text className="text-fg text-lg font-semibold tabular-nums">62,5</Text>
      </View>
      <View className="w-12 h-11 rounded-xl bg-bg-elevated items-center justify-center ml-2">
        <Text className="text-fg text-lg font-semibold tabular-nums">8</Text>
      </View>
      <View className="w-11 h-11 rounded-xl items-center justify-center ml-2 border-2 border-accent">
        <Check color={COLORS.accent} size={20} strokeWidth={3} />
      </View>
    </View>
  );
}
